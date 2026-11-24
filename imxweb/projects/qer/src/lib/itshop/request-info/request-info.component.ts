/*
 * ONE IDENTITY LLC. PROPRIETARY INFORMATION
 *
 * This software is confidential.  One Identity, LLC. or one of its affiliates or
 * subsidiaries, has supplied this software to you under terms of a
 * license agreement, nondisclosure agreement or both.
 *
 * You may not copy, disclose, or use this software except in accordance with
 * those terms.
 *
 *
 * Copyright 2025 One Identity LLC.
 * ALL RIGHTS RESERVED.
 *
 * ONE IDENTITY LLC. MAKES NO REPRESENTATIONS OR
 * WARRANTIES ABOUT THE SUITABILITY OF THE SOFTWARE,
 * EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
 * TO THE IMPLIED WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE, OR
 * NON-INFRINGEMENT.  ONE IDENTITY LLC. SHALL NOT BE
 * LIABLE FOR ANY DAMAGES SUFFERED BY LICENSEE
 * AS A RESULT OF USING, MODIFYING OR DISTRIBUTING
 * THIS SOFTWARE OR ITS DERIVATIVES.
 *
 */

import { Component, EventEmitter, Input, Output, OnDestroy, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { Subscription } from 'rxjs';

import { PortalShopServiceitems, QerProjectConfig } from '@imx-modules/imx-api-qer';
import { EntityData } from '@imx-modules/imx-qbm-dbts';
import moment from 'moment';
import { BaseReadonlyCdr, BusyService, ClassloggerService, ColumnDependentReference, ExtService, IExtension } from 'qbm';
import { ProjectConfigurationService } from '../../project-configuration/project-configuration.service';
import { DecisionHistoryService } from '../decision-history.service';
import { ItshopService } from '../itshop.service';
import { ApproverContainer } from './approver-container';
import { RequestParameterDataEntity } from './request-parameter-data-entity.interface';
import { WorkflowHistoryItemWrapper } from './workflow-history-item-wrapper';

@Component({
  templateUrl: './request-info.component.html',
  selector: 'imx-requestinfo',
  styleUrls: ['./request-info.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class RequestInfoComponent implements OnInit, OnDestroy {
  @Input() public isReadOnly: boolean; // TODO later: an einer passenden Stelle verarbeiten
  @Input() public request: RequestParameterDataEntity;
  @Input() public userId: string;
  @Input() public isApproval: boolean;
  @Output() public workflowActiveChange = new EventEmitter<boolean>();

  public parameters: (BaseReadonlyCdr | undefined)[];
  public propertyInfo: ColumnDependentReference[];
  public approverContainer: ApproverContainer;
  public workflow: WorkflowHistoryItemWrapper[];
  public readonly ruleViolationDetailId = 'cpl.ruleViolationDetail';
  public extensions: IExtension[] = [];
  public serviceItem: PortalShopServiceitems | undefined;
  public projectConfig: QerProjectConfig;
  public isRoleAssignment: boolean;
  public isLoading = false;
  public canLoadMore = false;

  private busyService = new BusyService();
  private subscriptions: Subscription[] = [];
  public startIndex: number = 0;
  private sortedDataCache: EntityData[];

  constructor(
    private readonly projectConfigService: ProjectConfigurationService,
    private readonly logger: ClassloggerService,
    private readonly itshopService: ItshopService,
    private readonly decisionHistory: DecisionHistoryService,
    private readonly ext: ExtService,
  ) {
    this.extensions = this.ext.Registry[this.ruleViolationDetailId];

    this.subscriptions.push(
      this.busyService.busyStateChanged.subscribe((state: boolean) => {
        this.isLoading = state;
      }),
    );
    this.workflow = [];
  }

  public async ngOnInit(): Promise<void> {
    const isBusy = this.busyService.beginBusy();
    try {
      this.projectConfig = await this.projectConfigService.getConfig();
      await this.refreshWorkflow(this.request);

      this.isRoleAssignment = ['ESet', 'QERAssign'].includes(this.request.TableName.value);
      if (!this.isRoleAssignment) {
        this.serviceItem = await this.itshopService.getServiceItem(
          this.request.UID_AccProduct.value,
          // if the service item is not in the catalog, just use null
          true,
        );
      }
    } finally {
      isBusy.endBusy();
    }
    this.logger.debug(this, 'approverContainer has been initialized');
  }

  /** Refresh the open view without replacing the tabs or showing the initial loading screen. */
  public async refreshWorkflow(request: RequestParameterDataEntity, signal?: AbortSignal): Promise<boolean> {
    if (!this.projectConfig || signal?.aborted) return false;
    const approvers = await this.itshopService.getApprovers(request.GetEntity().GetKeys()[0], signal);
    if (signal?.aborted) return false;
    const approverContainer = new ApproverContainer(
      {
        decisionLevel: request.DecisionLevel.value,
        qerWorkingMethod: request.UID_QERWorkingMethod.value,
        isInWorkflow: ['OrderProduct', 'OrderUnsubscribe', 'OrderProlongate'].includes(request.UiOrderState.value),
        pwoData: request.pwoData,
        approvers: approvers.Data.map((person) => person.UID_Person.value),
      },
      this.projectConfig.ITShopConfig,
      this.logger,
    );
    // Preserve the number of loaded history pages, but replace entries instead of appending duplicates.
    const lastPage = this.startIndex;
    this.request = request;
    this.approverContainer = approverContainer;
    this.sortedDataCache = [...(request.pwoData.WorkflowHistory?.Entities ?? [])].sort((a, b) =>
      moment(a.Columns?.XDateInserted?.Value ?? a.Columns?.DateHead?.Value).diff(
        moment(b.Columns?.XDateInserted?.Value ?? b.Columns?.DateHead?.Value),
      ),
    );
    this.propertyInfo = (request.propertyInfo ?? []).filter((property) => this.isForView(property));
    this.parameters = request.parameterColumns.filter((column) => column != null).map((column) => new BaseReadonlyCdr(column!));
    this.workflow = [];
    for (let page = 0; page <= lastPage && (page === 0 || page < this.sortedDataCache.length); page += 100) this.updateWorkflow(page);
    return true;
  }

  public updateWorkflow(startIndex: number = 0) {
    this.startIndex = startIndex;

    /**calculate currently show workflow data */
    const workflowData = this.itshopService
      .createTypedHistory(this.sortedDataCache, this.startIndex)
      .map((item, index) => new WorkflowHistoryItemWrapper(item, this.decisionHistory, this.getComplianceRule(this.startIndex + index)));

    this.workflow.push(...workflowData); //add workflow data
    this.canLoadMore = this.workflow.length < (this.request.pwoData.WorkflowHistory?.Entities?.length ?? 0);
  }

  public ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  private isForView(cdr: ColumnDependentReference): boolean {
    return cdr.column.ColumnName !== 'PWOPriority' || cdr.column.GetValue() !== 0;
  }

  private getComplianceRule(index: number): string {
    const elem = this.sortedDataCache?.[index]?.Columns?.UID_ComplianceRule;
    return elem?.DisplayValue ?? '';
  }
}
