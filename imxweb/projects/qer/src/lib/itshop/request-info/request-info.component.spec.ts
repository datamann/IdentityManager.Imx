import { RequestInfoComponent } from './request-info.component';

describe('RequestInfoComponent workflow updates', () => {
  let component: RequestInfoComponent;
  let service: any;
  const request = (state: string) =>
    ({
      GetEntity: () => ({ GetKeys: () => ['request-1'] }),
      DecisionLevel: { value: 1 },
      UID_QERWorkingMethod: { value: '' },
      UiOrderState: { value: state },
      pwoData: { WorkflowHistory: { Entities: [] } },
      propertyInfo: [],
      parameterColumns: [],
    }) as any;

  beforeEach(() => {
    service = {
      getApprovers: jasmine.createSpy('getApprovers').and.resolveTo({ Data: [] }),
      createTypedHistory: jasmine.createSpy('createTypedHistory').and.returnValue([]),
    };
    component = new RequestInfoComponent(
      {} as any,
      { trace: jasmine.createSpy('trace') } as any,
      service,
      {} as any,
      { Registry: {} } as any,
    );
    component.projectConfig = {
      RiskThresholdHigh: 1,
      EnableNewDelegationSubstitute: false,
      EnableNewDelegationIndividual: false,
      EnableHyperViewNavigation: false,
    };
    component.request = request('OrderProduct');
  });
  afterEach(() => component.ngOnDestroy());

  it('rebuilds current approvers and clears stale history without the loading screen', async () => {
    await component.refreshWorkflow(component.request);
    const previous = component.approverContainer;
    component.workflow = [{} as any];
    const latest = request('Assigned');
    expect(await component.refreshWorkflow(latest)).toBeTrue();
    expect(component.approverContainer).not.toBe(previous);
    expect(component.approverContainer.isInWorkflow).toBeFalse();
    expect(component.workflow).toEqual([]);
    expect(component.request).toBe(latest);
    expect(component.isLoading).toBeFalse();
  });

  it('preserves loaded history pages without mutating the API history order', async () => {
    const latest = request('OrderProduct');
    latest.pwoData.WorkflowHistory.Entities = Array.from({ length: 205 }, (_, i) => ({
      Columns: { XDateInserted: { Value: new Date(205 - i) } },
    }));
    const first = latest.pwoData.WorkflowHistory.Entities[0];
    component.startIndex = 100;
    await component.refreshWorkflow(latest);
    expect(service.createTypedHistory.calls.allArgs().map((args: any[]) => args[1])).toEqual([0, 100]);
    expect(latest.pwoData.WorkflowHistory.Entities[0]).toBe(first);
    expect(component.canLoadMore).toBeTrue();
  });

  it('does not apply data when closed during the approver request', async () => {
    let resolve: (value: any) => void;
    service.getApprovers.and.returnValue(new Promise((done) => (resolve = done)));
    const original = component.request;
    const controller = new AbortController();
    const pending = component.refreshWorkflow(request('Assigned'), controller.signal);
    controller.abort();
    resolve!({ Data: [] });
    expect(await pending).toBeFalse();
    expect(component.request).toBe(original);
  });
});
