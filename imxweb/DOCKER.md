# Webportalen på Dokploy

Oppsettet bygger `qer-app-portal` og tilhørende biblioteker med Node 26.13.1 LTS, npm 12.2.3, Angular 22.3.0 og Nx 24.0.6. Nginx serverer portalen og videresender API-kall til Identity Manager API-serveren.

## Eksperimentell oppgradering av Node og Angular

Feature-branchen `feat/upgrade-node-angular` er et oppgraderingsforsøk. Produksjonsbruk krever funksjonstest mot OIM, særlig innlogging/utlogging, personoppslag, skjemaer, datoer, navigasjon, rapporter og dynamiske utvidelseskomponenter.

- Angular ble først prøvd med versjon 21.2.26. Portalen og alle 17 avhengige biblioteker bygget før neste steg til Angular 22.3.0, TypeScript 6.0.3 og Nx 24.0.6.
- De offisielle Angular 22- og Nx-migreringene er kjørt. Eksisterende standardoppførsel for komponentoppdatering er beholdt med `ChangeDetectionStrategy.Eager` og eksplisitt Zone.js-basert oppdatering ved bootstrap. Angulars nye standard for støttede nettlesere brukes i stedet for listen fra Angular 20.
- Dynamiske komponenter opprettes med komponenttypen direkte, siden `ComponentFactoryResolver` er fjernet. Eksterne utvidelser som bruker den gamle konstruktøren til `BaseCdrEditorProvider`, må tilpasses tilsvarende.
- Den medfølgende `@elemental-ui/core` 20.0.79 krever Angular 20. Fire eksplisitte npm-overrides tillater kompatibilitetsprøven med nyere Angular. Dette er ikke en erklæring om leverandørstøtte. Erstatt pakken med en Angular 22-kompatibel distribusjon fra One Identity, oppdater eventuelle ikon- og peer-avhengigheter og fjern overridene før kombinasjonen vurderes som støttet. [Elemental-dokumentasjonen](https://elemental.dev.oneidentity.com/) bruker en nyere Angular-kodebase, men pakken distribueres via en autentisert Azure-feed.
- `scripts/patch-nx-angular.mjs` retter én import i Nx 24.0.6 fra en intern Architect-sti til det offentlige `@angular-devkit/architect/node`-endepunktet. Angular 22.3 eksporterer ikke lenger den interne stien. Patchen er idempotent, versjonslåst og må vurderes på nytt ved neste Nx-oppgradering. Den kjøres av postinstall, Docker og CI.

Installer Node-versjonen i `.node-version` og npm-versjonen i `packageManager`. Kjør fra `imxweb`:

```powershell
npm ci --ignore-scripts
node scripts/patch-nx-angular.mjs
npx --no-install nx build qer-app-portal --configuration=production --parallel=2
```

Lokal installasjon bruker de medfølgende arkivene i `imx-modules`, som nå også inngår i låsefilen. Vanlig `npm install` beholder låsefilreferansene og kjører patchen automatisk. Med `--ignore-scripts` må patchen kjøres eksplisitt som vist over. Systemets globale Node-installasjon trenger ikke endres for å bygge Docker-imaget.

Verifisert lokalt på Windows med Node 26.13.1 og npm 12.2.3: ren `npm ci --ignore-scripts`, etterfulgt av kompatibilitetspatchen, alle 22 produksjonsbygg uten byggcache og samlet testkjøring med ChromeHeadless. QBM har 253 tester, QER 176 og AOB 29; flere prosjekter har ingen enhetstester. Dette bekrefter ikke funksjonene mot en kjørende OIM-server. Docker-imaget er ikke bygget lokalt.

## Deploy fra Git

1. Opprett en **Docker Compose**-tjeneste i Dokploy og koble til dette Git-repositoriet og ønsket branch.
2. Bruk Docker Compose som deploytype. Sett **Compose Path** relativt til arbeidsmappen Dokploy bruker. Velg kombinasjonen som passer tjenesten i tabellen nedenfor.
3. Legg inn miljøvariabelen `API_SERVER_URL` i Dokploy, for eksempel `https://api.example.no/IdentityManager`. Adressen skal inkludere eventuell virtuell mappe for API-serveren. Bruk serverens base-URL, uten `/portal`, `/imx`, `/html`, spørringsparametere eller innloggingsinformasjon.
4. Under **Domains**, velg tjenesten `portal`, port `80`, og path `/`. Koble til portalens offentlige domene og aktiver HTTPS. La Dokploy legge til Traefik-ruting og nettverk.
5. Deploy og kontroller bygg- og containerloggene.

| Arbeidsmappe / Build Path         | Compose Path                  | PORTAL_BUILD_CONTEXT                        |
| --------------------------------- | ----------------------------- | ------------------------------------------- |
| `imxweb`                          | `./docker-compose.yml`        | `.` (standard)                              |
| Repositoryets rot (`.` eller `/`) | `./imxweb/docker-compose.yml` | `.` (standard ved vanlig Compose-oppførsel) |

Når arbeidsmappen allerede er `imxweb`, er Compose-stien `./docker-compose.yml`. Dokploy oppretter miljøfilen ved siden av Compose-filen. Kombinasjonen arbeidsmappe `imxweb` og Compose Path `imxweb/docker-compose.yml` gir derfor en feil sti med `imxweb/imxweb/.env`.

Nginx bruker `API_SERVER_URL` ved containeroppstart. En endret API-adresse krever at containeren opprettes på nytt. Domenet skal peke til Dokploy-serveren.

Compose bruker intern port 80. Dokploy håndterer den offentlige HTTPS-tilkoblingen. [Dokploy-dokumentasjon](https://docs.dokploy.com/docs/core/docker-compose/domains)

## Eksisterende Application-tjeneste med Dockerfile

En eksisterende Application-tjeneste kan bruke Dockerfile direkte. Bruk disse innstillingene når Git-repositoriet er klonet med prosjektets vanlige mappestruktur.

| Innstilling           | Verdi               |
| --------------------- | ------------------- |
| Branch                | `development`       |
| Build Type            | `Dockerfile`        |
| Build Path            | `/imxweb`           |
| Dockerfile Path       | `Dockerfile`        |
| Docker Context Path   | `/imxweb`           |
| Docker Build Stage    | La feltet være tomt |
| Domain Container Port | `80`                |

Docker Context Path tolkes relativt til repositoryets rot. Med `/imxweb` som verdi finner Docker både `package.json`, `imx-modules` og `docker/15-configure-api.envsh` i byggkonteksten. Dockerfile Path tolkes relativt til Build Path. [Dokploys beregning av filstier](https://github.com/Dokploy/dokploy/blob/canary/packages/server/src/utils/filesystem/directory.ts)

Branchnavn skiller mellom store og små bokstaver. Velg `development` med liten `d`, og kontroller at branchen inneholder `imxweb/Dockerfile`. `Development` er en separat branch dersom begge navnene finnes på GitHub.

Sett `API_SERVER_URL` under tjenestens miljøvariabler, slik at den finnes når containeren starter. Hvis Dokploy viser valget **Create .env File**, kan dette slås av for denne Application-tjenesten. API-adressen brukes ved containeroppstart.

Feilen `cannot create .../applications/.../code/imxweb/imxweb/.env` viser at Dokploy forsøker å opprette miljøfilen i en dobbelt undermappe. Kontroller både Build Path og Dockerfile Path. Med Build Path `/imxweb` skal Dockerfile Path være `Dockerfile`. Lagre endringene før neste deploy. [Dokploys Dockerfile-innstillinger](https://docs.dokploy.com/docs/core/applications/build-type)

## Tilkobling til API-serveren

Produksjonskonfigurasjonen har allerede `clientUrl: ''`. `AppConfigService` bruker derfor nettleserens domene som API-base. Nettleseren sender eksempelvis `/portal/...` og `/imx/...` til portaldomenet. Nginx sender forespørslene videre til `API_SERVER_URL` med samme metode, innhold og spørringsparametere.

Hvis `API_SERVER_URL=https://api.example.no/IdentityManager`, blir `/portal/example` videresendt til `https://api.example.no/IdentityManager/portal/example`. Portalen publiseres på domenets rot og bruker eksisterende hash-ruting.

Følgende må kontrolleres i miljøet.

- Dokploy-containeren må kunne slå opp API-serverens DNS-navn og nå porten gjennom brannmur eller VPN. `localhost` i denne adressen viser til selve portalcontaineren. Bruk et navn eller en IP-adresse som kan nås fra containeren.
- API-serveren og de medfølgende klientpakkene må være versjonsmessig kompatible. Klienten sender `imx-version` til API-serveren.
- API-serveren må godta den offentlige portaladressen i sine innstillinger for ekstern URL, tillatte verter og reverse proxy. Nginx sender backend-verten i `Host` og portalens offentlige vert og protokoll i `X-Forwarded-Host` og `X-Forwarded-Proto`. De konkrete serverinnstillingene avhenger av installasjonen.
- Nettleseren bruker samme origin for portal og API. CORS er vanligvis unødvendig for denne trafikken. Eventuelle eksisterende origin- eller CSRF-kontroller på API-serveren må tillate portalens HTTPS-origin.
- Nginx videresender autentiseringsinformasjon og cookies, tilpasser cookie-domene og cookie-path til portaldomenet og beholder cookie-flagg fra API-serveren.
- Ved OAuth/OIDC må identitetsleverandøren og API-serveren bruke korrekte offentlige callback- og logout-adresser. Eksterne redirects til identitetsleverandøren beholdes. Kontroller hele innloggings- og utloggingsflyten.
- Ved Windows-integrert autentisering må Kerberos/NTLM og eventuell delegering vurderes særskilt. Oppsettet er ikke verifisert for denne innloggingsformen.
- Lenker til andre Identity Manager-apper under `/html/`, som passordportalen, sendes videre til API-serveren. Disse appene må være tilgjengelige der hvis lenkene skal brukes.

## OAuth-retur til Docker-portalen

For innlogging i Docker-portalen skal OIM-applikasjonens Redirect URI være portalens offentlige rotadresse, for eksempel `https://webportal.lab.sbsivertsen.no/`. Samme adresse må tillates som Valid redirect URI i Keycloak. `API_SERVER_URL` skal fortsatt peke til API-serveren, for eksempel `https://api.lab.sbsivertsen.no/ApiServer/`.

Nginx sender forespørsler til portalroten med en ikke-tom `state`-parameter videre til API-serverens rot under `API_SERVER_URL`. API-serveren behandler OAuth-state og returnerer nettleseren til portalen med `Module` og `code`. Rotforespørsler uten `state` laster Angular som vanlig. Ikke legg en egen videresending fra portalroten til IIS-roten på API-domenet.

Test hele innloggingen etter deploy; korrekt videresending alene bekrefter ikke tokenvalidering eller at en innlogget sesjon opprettes. Utlogging må også kontrolleres separat.

## HTTPS mot en intern API-server

Nginx kontrollerer API-serverens sertifikatkjede og vertsnavn. Ved et offentlig signert sertifikat brukes containerens standard CA-bundle.

Ved intern CA legger du en PEM-bundle med nødvendige rot- og mellomsertifikater i Dokploys filmontering og monterer den skrivebeskyttet på `/etc/nginx/certs/api-ca.pem`. Sett deretter miljøvariabelen `API_SERVER_CA_BUNDLE=/etc/nginx/certs/api-ca.pem`. Sertifikatet på API-serveren må være utstedt til vertsnavnet i `API_SERVER_URL`.

Bruk Dokploys filmonteringer for sertifikatfilen, slik at den er tilgjengelig ved nye deployer. [Dokploys veiledning for monteringer](https://docs.dokploy.com/docs/core/docker-compose)

Kontroller deploykommandoen i Dokploy-loggen dersom Dokploy legger til `--project-directory` ved bruk av monteringer. Når denne peker til repositoryets rot, sett `PORTAL_BUILD_CONTEXT=./imxweb`. Når den peker til `imxweb`, bruk `PORTAL_BUILD_CONTEXT=.`. Standardverdien `.` bruker Compose-filens mappe når prosjektmappen følger vanlig Compose-oppførsel.

## Endre API-serverens AppServer-tilkobling

Kopier `scripts/Set-OimAppServerConnection.ps1` til IIS-serveren og kjør det i Windows PowerShell 5.1 som administrator:

```powershell
.\Set-OimAppServerConnection.ps1
```

Skriptet spør etter nytt AppServer-navn, IIS-nettsted (standard `Default Web Site`) og API-applikasjon (standard `/ApiServer`). Et vertsnavn blir til `https://<vertsnavn>/AppServer/`. Oppgi en full HTTPS-URL hvis AppServer bruker en annen sti eller port.

Forhåndsvis endringen uten å lagre:

```powershell
.\Set-OimAppServerConnection.ps1 -ServerName api.lab.example.no -SiteName 'Default Web Site' -ApplicationPath /ApiServer -WhatIf
```

Skriptet endrer URL-feltet i `AppServerConnection`, beholder øvrige tilkoblingsverdier og eksisterende kryptering, og sikkerhetskopierer `web.config` til `%ProgramData%\OIMConfigBackups`. Det endrer ikke `BaseURL`, sesjonstokensertifikat, DNS eller IIS-bindinger. Lagring av `web.config` kan starte API-serveren på nytt og avbryte aktive forespørsler. Test søk i portalen etterpå. Ved behov kan sikkerhetskopien kopieres tilbake til den opprinnelige `web.config` på samme server.

## Bygg og kontroll

Kjør følgende fra `imxweb` i et miljø med Docker. Sett `API_SERVER_URL` i miljøet eller i en lokal `.env`-fil først.

```sh
docker compose config --quiet
docker compose build portal
docker compose up -d
docker compose exec portal nginx -t
docker compose exec portal wget -qO- http://127.0.0.1/healthz
```

Kontroller deretter følgende via det offentlige HTTPS-domenet.

1. Portalen, `appconfig.json`, statiske ressurser og modulene lastes.
2. Nettleserens nettverksfane viser API-kall til portaldomenet og gyldige API-svar.
3. Innlogging, utlogging og eventuell flerfaktorautentisering fungerer, og cookies har forventet domene, path og Secure-flagg.
4. Sentrale handlinger som oppslag, bestillinger og godkjenninger fungerer for testbrukeren.
5. Hendelsesstrømmer kobler til og leverer varsler fortløpende.

Helsesjekken tester Nginx. API-tilgjengelighet og innlogging kontrolleres gjennom portalens funksjonstester.

Byggesteget bruker arkivene i `imx-modules` og kjører `npm ci --ignore-scripts` med låsefilen, etterfulgt av den versjonslåste Nx-patchen. Native plattformpakker installeres som valgfrie avhengigheter. Bygget krever tilgang til npm-registeret for offentlige pakker og til containerregisteret for baseimager.

Bygg- og funksjonstestene bør gjennomføres som referanse før oppgradering av Node eller biblioteker.
