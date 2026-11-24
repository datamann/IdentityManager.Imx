import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { RequestDetailComponent } from './request-detail.component';

describe('RequestDetailComponent workflow refresh', () => {
  let component: RequestDetailComponent;
  let history: any;
  let document: any;
  let requestInfo: any;
  let logger: any;
  let original: any;
  let updated: any;

  beforeEach(() => {
    const request = (cancel: boolean) => ({
      GetEntity: () => ({ GetKeys: () => ['request-1'] }),
      CancelRequestAllowed: { value: cancel },
      isArchived: false,
    });
    original = request(false);
    updated = request(true);
    history = { getRequests: jasmine.createSpy('getRequests').and.resolveTo({ Data: [updated] }) };
    document = { visibilityState: 'visible' };
    requestInfo = { isLoading: false, refreshWorkflow: jasmine.createSpy('refreshWorkflow').and.resolveTo(true) };
    logger = { warn: jasmine.createSpy('warn') };
    component = new RequestDetailComponent(
      { personWantsOrg: original, userUid: 'user-1' },
      { applied: new Subject() } as any,
      {} as any,
      history,
      logger,
      document,
    );
    component.requestInfo = requestInfo;
    component.workflowActive = true;
  });
  afterEach(() => component.ngOnDestroy());

  it('refreshes only the selected request and updates action availability', fakeAsync(() => {
    component.ngOnInit();
    tick(14999);
    expect(history.getRequests).not.toHaveBeenCalled();
    tick(1);
    flushMicrotasks();
    expect(history.getRequests).toHaveBeenCalledWith('user-1', { uidpwo: 'request-1', PageSize: 1, status: '1,2,4' }, jasmine.anything());
    expect(requestInfo.refreshWorkflow).toHaveBeenCalledWith(updated, jasmine.anything());
    expect(component.data.personWantsOrg).toBe(updated);
    expect(component.allowedActionCount).toBe(1);
    component.ngOnDestroy();
  }));

  it('pauses while another tab is selected or the browser tab is hidden', fakeAsync(() => {
    component.ngOnInit();
    component.workflowActive = false;
    tick(15000);
    component.workflowActive = true;
    document.visibilityState = 'hidden';
    tick(15000);
    expect(history.getRequests).not.toHaveBeenCalled();
    document.visibilityState = 'visible';
    tick(15000);
    flushMicrotasks();
    expect(history.getRequests).toHaveBeenCalledTimes(1);
    component.ngOnDestroy();
  }));

  it('does not overlap slow requests', fakeAsync(() => {
    let resolve: (value: any) => void;
    history.getRequests.and.returnValue(new Promise((done) => (resolve = done)));
    component.ngOnInit();
    tick(45000);
    expect(history.getRequests).toHaveBeenCalledTimes(1);
    resolve!({ Data: [updated] });
    flushMicrotasks();
    tick(15000);
    expect(history.getRequests).toHaveBeenCalledTimes(2);
    flushMicrotasks();
    component.ngOnDestroy();
  }));

  it('aborts pending work and ignores late responses after closing', fakeAsync(() => {
    let resolve: (value: any) => void;
    history.getRequests.and.returnValue(new Promise((done) => (resolve = done)));
    component.ngOnInit();
    tick(15000);
    const signal = history.getRequests.calls.mostRecent().args[2] as AbortSignal;
    component.ngOnDestroy();
    expect(signal.aborted).toBeTrue();
    resolve!({ Data: [updated] });
    flushMicrotasks();
    tick(30000);
    expect(history.getRequests).toHaveBeenCalledTimes(1);
    expect(requestInfo.refreshWorkflow).not.toHaveBeenCalled();
    expect(component.data.personWantsOrg).toBe(original);
    component.ngOnDestroy();
  }));

  it('retains the current view after an error and retries on the next interval', fakeAsync(() => {
    history.getRequests.and.rejectWith(new Error('offline'));
    component.ngOnInit();
    tick(15000);
    flushMicrotasks();
    expect(component.data.personWantsOrg).toBe(original);
    expect(requestInfo.refreshWorkflow).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    history.getRequests.and.resolveTo({ Data: [updated] });
    tick(15000);
    flushMicrotasks();
    expect(component.data.personWantsOrg).toBe(updated);
    component.ngOnDestroy();
  }));

  it('does not poll archived requests', fakeAsync(() => {
    original.isArchived = true;
    component.ngOnInit();
    tick(45000);
    expect(history.getRequests).not.toHaveBeenCalled();
    component.ngOnDestroy();
  }));

  it('does not replace the request with an absent or mismatched result', fakeAsync(() => {
    history.getRequests.and.resolveTo({ Data: [{ GetEntity: () => ({ GetKeys: () => ['other-request'] }) }] });
    component.ngOnInit();
    tick(15000);
    flushMicrotasks();
    expect(component.data.personWantsOrg).toBe(original);
    expect(requestInfo.refreshWorkflow).not.toHaveBeenCalled();
    component.ngOnDestroy();
  }));
});
