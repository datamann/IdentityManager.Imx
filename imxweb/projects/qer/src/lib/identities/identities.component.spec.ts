import { Subject } from 'rxjs';
import { CollectionLoadParameters, DataModel, DisplayColumns, EntitySchema, IClientProperty, ValType } from '@imx-modules/imx-qbm-dbts';
import { DataViewInitParameters } from 'qbm';
import { DataExplorerIdentitiesComponent } from './identities.component';

describe('DataExplorerIdentitiesComponent department column', () => {
  let component: DataExplorerIdentitiesComponent;
  let baseSchema: EntitySchema;
  let dataModel: DataModel;
  let source: { init: jasmine.Spy };
  let identities: any;
  let initParameters: DataViewInitParameters<any>;
  const department: IClientProperty = { ColumnName: 'UID_Department', Type: ValType.String, Display: 'Primary department' };

  beforeEach(() => {
    const columns = Object.fromEntries(
      [DisplayColumns.DISPLAY_PROPERTYNAME, 'IsSecurityIncident', 'IdentityType', 'EmployeeType', 'IsExternal', 'XMarkedForDeletion'].map(
        (name) => [name, { ColumnName: name, Type: ValType.String }],
      ),
    );
    baseSchema = { TypeName: 'Person', Columns: columns };
    dataModel = {
      Properties: [{ Property: department, IsAdditionalColumn: true, IsFilterable: true, IsSortable: false, IsGroupable: false }],
    };
    source = {
      init: jasmine.createSpy('init').and.callFake(async (parameters) => {
        initParameters = parameters;
      }),
    };
    identities = {
      personReportsSchema: baseSchema,
      adminPersonSchema: { TypeName: 'Person', Columns: { ...columns, UID_Department: department } },
      authorityDataDeleted: new Subject<void>(),
      getDataModelReport: jasmine.createSpy('getDataModelReport').and.callFake(async () => dataModel),
      getDataModelAdmin: jasmine.createSpy('getDataModelAdmin').and.callFake(async () => dataModel),
      getReportsOfManager: jasmine.createSpy('getReportsOfManager').and.resolveTo({ Data: [] }),
      getAllPersonAdmin: jasmine.createSpy('getAllPersonAdmin').and.resolveTo({ Data: [] }),
      exportPerson: () => ({}),
      exportAdminPerson: () => ({}),
    };
    const dependencies = [
      {},
      source,
      {},
      {},
      {},
      { getConfig: async () => ({ PersonConfig: {} }) },
      {},
      identities,
      { getInitialDSTExtension: async () => ({}) },
      {},
      { onSessionResponse: new Subject() },
      {},
      {},
      { Registry: {} },
    ] as unknown as ConstructorParameters<typeof DataExplorerIdentitiesComponent>;
    component = new DataExplorerIdentitiesComponent(...dependencies);
  });

  afterEach(() => component.ngOnDestroy());

  it('uses additional department metadata without modifying the API schema', async () => {
    await component.ngOnInit();
    expect(component.departmentColumn).toEqual(department);
    expect(initParameters.columnsToDisplay.map((column) => column.ColumnName)).toContain('UID_Department');
    expect(baseSchema.Columns.UID_Department).toBeUndefined();
    expect(initParameters.schema.Columns).not.toBe(baseSchema.Columns);
    expect(initParameters.schema.Columns.UID_Department).toEqual(department);
    expect(initParameters.columnsToDisplay.every(Boolean)).toBeTrue();
  });

  it('requests department data on every page and preserves selected additional fields and filters', async () => {
    await component.ngOnInit();
    const signal = new AbortController().signal;
    const params: CollectionLoadParameters = { StartIndex: 20, PageSize: 20, reports: '1', withProperties: 'UID_Locality,UID_Department' };
    await initParameters.execute!(params, signal);
    expect(identities.getReportsOfManager).toHaveBeenCalledWith(params, signal);
    await initParameters.execute!({ PageSize: 20 }, signal);
    expect(identities.getReportsOfManager).toHaveBeenCalledWith({ PageSize: 20, withProperties: 'UID_Department' }, signal);
    expect(params.withProperties).toBe('UID_Locality,UID_Department');
  });

  it('keeps department requested after the view configuration removes other additional fields', async () => {
    await component.ngOnInit();
    const signal = new AbortController().signal;
    await initParameters.execute!({ withProperties: 'UID_Locality' }, signal);
    expect(identities.getReportsOfManager).toHaveBeenCalledWith({ withProperties: 'UID_Locality,UID_Department' }, signal);
    await initParameters.execute!({ withProperties: '' }, signal);
    expect(identities.getReportsOfManager).toHaveBeenCalledWith({ withProperties: 'UID_Department' }, signal);
  });

  it('omits department when neither the schema nor data model offers it', async () => {
    dataModel = { Properties: [] };
    await component.ngOnInit();
    expect(component.departmentColumn).toBeUndefined();
    expect(initParameters.columnsToDisplay.every(Boolean)).toBeTrue();
    expect(initParameters.columnsToDisplay.map((column) => column.ColumnName)).not.toContain('UID_Department');
    const signal = new AbortController().signal;
    await initParameters.execute!({ PageSize: 20 }, signal);
    expect(identities.getReportsOfManager).toHaveBeenCalledWith({ PageSize: 20 }, signal);
  });

  it('uses a built-in department column without requesting it as an additional field', async () => {
    identities.personReportsSchema = identities.adminPersonSchema;
    dataModel = { Properties: [] };
    await component.ngOnInit();
    expect(component.departmentColumn).toEqual(department);
    const signal = new AbortController().signal;
    await initParameters.execute!({}, signal);
    expect(identities.getReportsOfManager).toHaveBeenCalledWith({}, signal);
  });

  it('uses the admin endpoint schema in admin mode', async () => {
    component.isAdmin = true;
    dataModel = { Properties: [] };
    await component.ngOnInit();
    expect(identities.getDataModelAdmin).toHaveBeenCalled();
    expect(identities.getDataModelReport).not.toHaveBeenCalled();
    expect(component.departmentColumn).toEqual(department);
    const signal = new AbortController().signal;
    await initParameters.execute!({}, signal);
    expect(identities.getAllPersonAdmin).toHaveBeenCalledWith({}, signal);
    expect(identities.getReportsOfManager).not.toHaveBeenCalled();
  });
});
