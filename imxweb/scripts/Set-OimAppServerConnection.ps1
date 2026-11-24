#Requires -Version 5.1
<#
.SYNOPSIS
Updates the OIM API Server's encrypted AppServer connection in IIS.
.DESCRIPTION
Run in Windows PowerShell 5.1 as administrator on the IIS server. Prompts for
missing settings, backs up web.config outside the website, and preserves the
connectionStrings section's existing protection. No credentials are printed.
Saving web.config may restart the API Server and interrupt active requests.
.EXAMPLE
.\Set-OimAppServerConnection.ps1
.EXAMPLE
.\Set-OimAppServerConnection.ps1 -ServerName api.lab.example.no -WhatIf
.EXAMPLE
.\Set-OimAppServerConnection.ps1 -ServerName https://api.example.no:8443/OIMAppServer/ -SiteName 'Default Web Site' -ApplicationPath /ApiServer
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$ServerName,
    [string]$SiteName,
    [string]$ApplicationPath,
    [string]$BackupDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-Setting {
    param([string]$Prompt, [string]$DefaultValue)

    $answer = Read-Host "$Prompt [$DefaultValue]"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $DefaultValue }
    return $answer.Trim()
}

function ConvertTo-AppServerUri {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw 'Server name cannot be empty.'
    }

    $candidate = $Value.Trim()
    if ($candidate -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*://') {
        $candidate = 'https://' + $candidate
    }

    $parsedUri = $null
    if (-not [Uri]::TryCreate($candidate, [UriKind]::Absolute, [ref]$parsedUri)) {
        throw 'Enter a valid server name or HTTPS URL.'
    }
    if ($parsedUri.Scheme -ne 'https' -or
        [string]::IsNullOrWhiteSpace($parsedUri.Host) -or
        $parsedUri.UserInfo -or $parsedUri.Query -or $parsedUri.Fragment) {
        throw 'Use HTTPS without credentials, query parameters or a fragment.'
    }

    $uriBuilder = New-Object System.UriBuilder($parsedUri)
    if ($uriBuilder.Path -eq '/') {
        $uriBuilder.Path = '/AppServer/'
    }
    else {
        $uriBuilder.Path = $uriBuilder.Path.TrimEnd('/') + '/'
    }
    return $uriBuilder.Uri
}

if ($PSVersionTable.PSEdition -ne 'Desktop') {
    throw 'Run this script in Windows PowerShell 5.1 (powershell.exe), not PowerShell 7.'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Start Windows PowerShell as administrator on the IIS server.'
}

if ([string]::IsNullOrWhiteSpace($ServerName)) {
    $ServerName = Read-Host 'New AppServer host name or HTTPS URL (e.g. api.lab.example.no)'
}
$targetUri = ConvertTo-AppServerUri -Value $ServerName

if ([string]::IsNullOrWhiteSpace($SiteName)) {
    $SiteName = Read-Setting -Prompt 'IIS site' -DefaultValue 'Default Web Site'
}
if ([string]::IsNullOrWhiteSpace($ApplicationPath)) {
    $ApplicationPath = Read-Setting -Prompt 'API Server application path in IIS' -DefaultValue '/ApiServer'
}
if (-not $ApplicationPath.StartsWith('/') -or $ApplicationPath -match '[?#\\]') {
    throw 'Use an IIS application path such as /ApiServer.'
}

Add-Type -AssemblyName System.Web
Add-Type -AssemblyName System.Data
$apiConfig = [System.Web.Configuration.WebConfigurationManager]::OpenWebConfiguration(
    $ApplicationPath, $SiteName
)
$configPath = $apiConfig.FilePath
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf) -or
    [IO.Path]::GetFileName($configPath) -ine 'web.config') {
    throw 'The selected IIS application does not have a local web.config.'
}

$connectionSection = $apiConfig.GetSection('connectionStrings')
$entry = $connectionSection.ConnectionStrings['AppServerConnection']
if ($null -eq $entry -or [string]::IsNullOrWhiteSpace($entry.ConnectionString)) {
    throw 'AppServerConnection was not found. No changes were made.'
}
$isProtected = $connectionSection.SectionInformation.IsProtected
$providerName = if ($isProtected) {
    $connectionSection.SectionInformation.ProtectionProvider.Name
} else { '' }
$settings = New-Object System.Data.Common.DbConnectionStringBuilder
# Use the CLR setter: PowerShell dot assignment adds a dictionary key instead.
$settings.set_ConnectionString($entry.ConnectionString)
$urlKey = 'qbm.appserver.client.serviceclientfactory, qbm.appserver.client|url'
if (-not $settings.ContainsKey($urlKey)) {
    throw 'The expected AppServer URL setting was not found. No changes were made.'
}
if ([string]$settings[$urlKey] -eq $targetUri.AbsoluteUri) {
    Write-Output 'AppServerConnection already uses the requested URL. No changes made.'
    return
}

Write-Output "Configuration: $configPath"
Write-Output "New AppServer URL: $($targetUri.AbsoluteUri)"
Write-Output "Connection strings protected: $isProtected"
Write-Warning 'Saving web.config may restart the API Server and interrupt active requests.'

if (-not $PSCmdlet.ShouldProcess($configPath, 'Back up web.config and update AppServerConnection URL')) {
    return
}

if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
    $BackupDirectory = Join-Path $env:ProgramData 'OIMConfigBackups'
}
$backupRoot = [IO.Path]::GetFullPath($BackupDirectory)
$websiteRoot = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($configPath)).TrimEnd('\') + '\'
if (($backupRoot.TrimEnd('\') + '\').StartsWith($websiteRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The backup directory must be outside the API Server application directory.'
}
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$backupPath = Join-Path $backupRoot ('web-{0}-{1}.config' -f
    (Get-Date -Format 'yyyyMMdd-HHmmss'), [Guid]::NewGuid().ToString('N'))
Copy-Item -LiteralPath $configPath -Destination $backupPath -ErrorAction Stop
Write-Output "Backup: $backupPath"

try {
    $settings[$urlKey] = $targetUri.AbsoluteUri
    $entry.ConnectionString = $settings.get_ConnectionString()
    $apiConfig.Save([System.Configuration.ConfigurationSaveMode]::Modified)

    # Reopen the file to verify both the URL and the original protection state.
    $savedConfig = [System.Web.Configuration.WebConfigurationManager]::OpenWebConfiguration(
        $ApplicationPath, $SiteName
    )
    $savedSection = $savedConfig.GetSection('connectionStrings')
    $savedSettings = New-Object System.Data.Common.DbConnectionStringBuilder
    $savedSettings.set_ConnectionString(
        $savedSection.ConnectionStrings['AppServerConnection'].ConnectionString
    )
    $savedProviderName = if ($savedSection.SectionInformation.IsProtected) {
        $savedSection.SectionInformation.ProtectionProvider.Name
    } else { '' }
    if ([string]$savedSettings[$urlKey] -ne $targetUri.AbsoluteUri -or
        $savedSection.SectionInformation.IsProtected -ne $isProtected -or
        $savedProviderName -ne $providerName) {
        throw 'Verification of the saved URL or configuration protection failed.'
    }
}
catch {
    # Do not print exceptions that could contain decrypted connection strings.
    throw "Update or verification failed. Check web.config and restore the backup if needed: $backupPath"
}

Write-Output 'AppServerConnection updated and verified. Configuration protection preserved.'
Write-Output 'Test person search in the portal. No BaseURL or token certificate settings were changed.'
