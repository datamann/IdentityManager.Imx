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

import { Component, DOCUMENT, Inject, OnInit, OnDestroy, ViewChild, ChangeDetectionStrategy } from '@angular/core';
import { EUI_SIDESHEET_DATA, EuiSidesheetRef } from '@elemental-ui/core';
import { exhaustMap, filter, interval, Subscription } from 'rxjs';
import { ClassloggerService } from 'qbm';
import { RequestInfoComponent } from '../../itshop/request-info/request-info.component';
import { RequestHistoryService } from '../request-history.service';

import { RequestActionService } from '../request-action/request-action.service';
import { RequestDetailParameter } from './request-detail-parameter.interface';

@Component({
  templateUrl: './request-detail.component.html',
  selector: 'imx-request-detail',
  styleUrls: ['./request-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class RequestDetailComponent implements OnInit, OnDestroy {
  public workflowActive = false;
  @ViewChild(RequestInfoComponent) public requestInfo: RequestInfoComponent;

  private readonly subscriptions: Subscription[] = [];
  private readonly refreshController = new AbortController();

  constructor(
    @Inject(EUI_SIDESHEET_DATA) public readonly data: RequestDetailParameter,
    public readonly actionService: RequestActionService,
    private readonly sideSheetRef: EuiSidesheetRef,
    private readonly requestHistory: RequestHistoryService,
    private readonly logger: ClassloggerService,
    @Inject(DOCUMENT) private readonly document: Document,
  ) {
    this.subscriptions.push(this.actionService.applied.subscribe(() => this.sideSheetRef.close(true)));
  }

  public get allowedActionCount(): number {
    return this.data.disableActions === true
      ? 0
      : [
          // TODO Later: this.data.personWantsOrg.ResendRequestAllowed.value,
          this.data.personWantsOrg.canProlongate,
          this.data.personWantsOrg.CancelRequestAllowed.value,
          this.data.personWantsOrg.canWithdrawDelegation && this.data.itShopConfig?.VI_ITShop_OrderHistory_CancelOrder,
          this.data.personWantsOrg.canWithdrawAdditionalApprover && this.data.itShopConfig?.VI_ITShop_OrderHistory_CancelOrder,
          this.data.personWantsOrg.canRecallLastQuestion,
          this.data.personWantsOrg.canRevokeHoldStatus,
          this.data.personWantsOrg.canRecallDecision,
          this.data.personWantsOrg.canCopyItems,
        ].filter((condition) => condition).length;
  }

  public ngOnInit(): void {
    if (this.data.personWantsOrg.isArchived) return;
    this.subscriptions.push(
      interval(15000)
        .pipe(
          filter(
            () => this.workflowActive && this.document.visibilityState !== 'hidden' && !!this.requestInfo && !this.requestInfo.isLoading,
          ),
          exhaustMap(() => this.refreshRequest()),
        )
        .subscribe(),
    );
  }

  private async refreshRequest(): Promise<void> {
    const signal = this.refreshController.signal;
    try {
      const uidpwo = this.data.personWantsOrg.GetEntity().GetKeys()[0];
      const result = await this.requestHistory.getRequests(this.data.userUid, { uidpwo, PageSize: 1, status: '1,2,4' }, signal);
      if (signal.aborted || !this.workflowActive || this.document.visibilityState === 'hidden') return;
      const request = result.Data.find((item) => item.GetEntity().GetKeys()[0] === uidpwo);
      if (request && (await this.requestInfo.refreshWorkflow(request, signal)) && !signal.aborted) {
        this.data.personWantsOrg = request;
      }
    } catch {
      // Keep the last successful view and retry on the next interval.
      if (!signal.aborted) this.logger.warn(this, 'Unable to refresh request workflow; keeping the previous status.');
    }
  }

  public ngOnDestroy(): void {
    this.refreshController.abort();
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  // ToDo later
  // public submitAgain(): void {
  //     // TODO VI_ITShop_PersonWantsOrg_Resubmit({ PersonWantsOrg: PersonWantsOrg});
  //     // Benötigt den ShoppingCart Branch
  //    this.dialogRef.close(this.reload);
  // }
}
