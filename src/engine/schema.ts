import {
  EnterpriseSheets,
  IndustryKey,
  PlanningDomainKey,
  TableContract,
  ValidationCategoryKey,
  ValidationRuleConfig,
} from './types';

export const INDUSTRY_LABELS: Record<IndustryKey, string> = {
  cpg: 'FMCG & Beverages',
  pharma: 'Pharma & Healthcare',
  retail: 'Fashion & Retail',
  electronics: 'Consumer Electronics',
  auto: 'Automotive Spares',
  chemicals: 'Paints, Chemicals & Agri',
};

export const PLANNING_DOMAIN_LABELS: Record<PlanningDomainKey, string> = {
  ALL: 'All Domains (Unified Enterprise IBP)',
  DEMAND: 'Demand Planning',
  SUPPLY: 'Supply & Replenishment Planning',
  SOP: 'Sales & Operations Planning (S&OP)',
  MEIO: 'Multi-Echelon Inventory (MEIO)',
  PROCUREMENT: 'Procurement & Sourcing Planning',
  MANUFACTURING: 'Manufacturing & Production Planning',
};

export interface DomainContractDefinition {
  label: string;
  mandatoryTables: string[];
  relevantTables: string[];
  requiredMasterTables: string[];
  requiredCategories: ValidationCategoryKey[];
  domainRules: string[];
}

export const DOMAIN_CONTRACTS: Record<PlanningDomainKey, DomainContractDefinition> = {
  ALL: {
    label: 'Unified Enterprise IBP',
    mandatoryTables: [
      '01_Orders_Shipments_History',
      '02_Forecast_Vintages_Lag',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '11_Customer_Channel_Master',
    ],
    relevantTables: [
      '01_Orders_Shipments_History',
      '02_Forecast_Vintages_Lag',
      '03_Commercial_Sales_Inputs',
      '04_Trade_Promotions_Calendar',
      '05_Festivals_Holidays_Events',
      '06_Pricing_Elasticity_Catalog',
      '07_Inventory_Supply_Constraints',
      '08_Weather_Macro_Indices',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '11_Customer_Channel_Master',
      '12_NPI_Lifecycle_Transitions',
      '13_Supplier_Sourcing_Contracts',
      '14_Purchase_Orders_Receipts',
      '15_Manufacturing_BOM_WorkCenters',
      '16_MEIO_Network_Policy_Costs',
    ],
    requiredMasterTables: [
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '11_Customer_Channel_Master',
    ],
    requiredCategories: [
      'schemaCompleteness',
      'timeAndKeyIntegrity',
      'stockoutDetection',
      'crossTableJoins',
      'promoAndPriceBounds',
      'uomAndSecuritySync',
    ],
    domainRules: [
      'Full 12+4 enterprise schema, period continuity, SKU/Location/Channel referential integrity, stockout censoring, promo overlaps, UOM conversion, and cell security.',
    ],
  },
  DEMAND: {
    label: 'Demand Planning',
    mandatoryTables: [
      '01_Orders_Shipments_History',
      '02_Forecast_Vintages_Lag',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '11_Customer_Channel_Master',
    ],
    relevantTables: [
      '01_Orders_Shipments_History',
      '02_Forecast_Vintages_Lag',
      '03_Commercial_Sales_Inputs',
      '04_Trade_Promotions_Calendar',
      '05_Festivals_Holidays_Events',
      '08_Weather_Macro_Indices',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '11_Customer_Channel_Master',
      '12_NPI_Lifecycle_Transitions',
    ],
    requiredMasterTables: [
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '11_Customer_Channel_Master',
    ],
    requiredCategories: [
      'schemaCompleteness',
      'timeAndKeyIntegrity',
      'crossTableJoins',
      'promoAndPriceBounds',
      'uomAndSecuritySync',
    ],
    domainRules: [
      'Demand time-series continuity (monthly/weekly gaps), outlier spike tagging, credit-return vs negative billing classification, trade promo window & overlap checks, and NPI analog SKU lineage.',
    ],
  },
  SUPPLY: {
    label: 'Supply & Replenishment Planning',
    mandatoryTables: [
      '01_Orders_Shipments_History',
      '07_Inventory_Supply_Constraints',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
    ],
    relevantTables: [
      '01_Orders_Shipments_History',
      '02_Forecast_Vintages_Lag',
      '07_Inventory_Supply_Constraints',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '13_Supplier_Sourcing_Contracts',
      '14_Purchase_Orders_Receipts',
    ],
    requiredMasterTables: [
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
    ],
    requiredCategories: [
      'schemaCompleteness',
      'timeAndKeyIntegrity',
      'stockoutDetection',
      'crossTableJoins',
      'uomAndSecuritySync',
    ],
    domainRules: [
      'Depot stockout censoring detection, transit lead-time ceiling compliance, supplier sourcing MOQ/order-multiple integrity, and SKU × Location master referential integrity (independent of Customer Channel Master).',
    ],
  },
  SOP: {
    label: 'Sales & Operations Planning (S&OP)',
    mandatoryTables: [
      '01_Orders_Shipments_History',
      '02_Forecast_Vintages_Lag',
      '03_Commercial_Sales_Inputs',
      '06_Pricing_Elasticity_Catalog',
      '07_Inventory_Supply_Constraints',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '11_Customer_Channel_Master',
    ],
    relevantTables: [
      '01_Orders_Shipments_History',
      '02_Forecast_Vintages_Lag',
      '03_Commercial_Sales_Inputs',
      '04_Trade_Promotions_Calendar',
      '06_Pricing_Elasticity_Catalog',
      '07_Inventory_Supply_Constraints',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '11_Customer_Channel_Master',
    ],
    requiredMasterTables: [
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '11_Customer_Channel_Master',
    ],
    requiredCategories: [
      'schemaCompleteness',
      'timeAndKeyIntegrity',
      'stockoutDetection',
      'crossTableJoins',
      'promoAndPriceBounds',
      'uomAndSecuritySync',
    ],
    domainRules: [
      'Commercial override vs Finance AOP reason-code enforcement, effective price/COGS positive margin verification, revenue realization reconciliation, and executive consensus horizon alignment.',
    ],
  },
  MEIO: {
    label: 'Multi-Echelon Inventory (MEIO)',
    mandatoryTables: [
      '01_Orders_Shipments_History',
      '07_Inventory_Supply_Constraints',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '11_Customer_Channel_Master',
    ],
    relevantTables: [
      '01_Orders_Shipments_History',
      '02_Forecast_Vintages_Lag',
      '06_Pricing_Elasticity_Catalog',
      '07_Inventory_Supply_Constraints',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '11_Customer_Channel_Master',
      '16_MEIO_Network_Policy_Costs',
    ],
    requiredMasterTables: [
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '11_Customer_Channel_Master',
    ],
    requiredCategories: [
      'schemaCompleteness',
      'timeAndKeyIntegrity',
      'stockoutDetection',
      'crossTableJoins',
      'uomAndSecuritySync',
    ],
    domainRules: [
      'Echelon transit lead-time & variability bounds, channel OTIF SLA floor enforcement, annual holding cost % bounds (0 < Holding_Cost ≤ 100%), and safety-stock min/max cap consistency.',
    ],
  },
  PROCUREMENT: {
    label: 'Procurement & Sourcing Planning',
    mandatoryTables: [
      '06_Pricing_Elasticity_Catalog',
      '07_Inventory_Supply_Constraints',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
    ],
    relevantTables: [
      '06_Pricing_Elasticity_Catalog',
      '07_Inventory_Supply_Constraints',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '13_Supplier_Sourcing_Contracts',
      '14_Purchase_Orders_Receipts',
    ],
    requiredMasterTables: [
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
    ],
    requiredCategories: [
      'schemaCompleteness',
      'stockoutDetection',
      'crossTableJoins',
      'promoAndPriceBounds',
      'uomAndSecuritySync',
    ],
    domainRules: [
      'Supplier contract MOQ (> 0) and order-multiple divisibility, supplier lead-time ceiling compliance, purchase-order vs receipt quantity reconciliation, and unit cost / pack UOM verification (isolated from Customer Channel Master and Trade Promotions).',
    ],
  },
  MANUFACTURING: {
    label: 'Manufacturing & Production Planning',
    mandatoryTables: [
      '07_Inventory_Supply_Constraints',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
    ],
    relevantTables: [
      '07_Inventory_Supply_Constraints',
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
      '15_Manufacturing_BOM_WorkCenters',
    ],
    requiredMasterTables: [
      '09_Product_Master_Hierarchy',
      '10_Location_Depot_Network',
    ],
    requiredCategories: [
      'schemaCompleteness',
      'stockoutDetection',
      'crossTableJoins',
      'uomAndSecuritySync',
    ],
    domainRules: [
      'BOM parent/component SKU referential integrity, production yield % bounds (0 < Yield ≤ 100%), scrap factor % bounds (0 ≤ Scrap < 100%), work-center capacity vs required run hours, and pack UOM conversion.',
    ],
  },
};

export const DEFAULT_RULE_CONFIG: ValidationRuleConfig = {
  outlierSigmaThreshold: 3.0,
  forecastUpperCorridorPct: 80,
  salesOverrideMaxPct: 25,
  standardCasePackMin: 12,
  minServiceLevelPct: 95,
  maxLeadTimeDays: 30,
  reconciliationTolerancePct: 5,
  enforceMoqOrderMultiples: true,
  enforceFutureDateGuard: true,
  ruleVersion: 'Argon-Rules-v2.5',
};

export const INDUSTRY_DEFAULT_RULE_CONFIGS: Record<IndustryKey, ValidationRuleConfig> = {
  cpg: {
    ...DEFAULT_RULE_CONFIG,
    standardCasePackMin: 12,
    forecastUpperCorridorPct: 80,
    salesOverrideMaxPct: 25,
    minServiceLevelPct: 95,
    maxLeadTimeDays: 21,
    ruleVersion: 'Argon-CPG-v2.5',
  },
  pharma: {
    ...DEFAULT_RULE_CONFIG,
    standardCasePackMin: 24,
    forecastUpperCorridorPct: 50,
    salesOverrideMaxPct: 15,
    minServiceLevelPct: 98.5,
    maxLeadTimeDays: 14,
    ruleVersion: 'Argon-Pharma-GMP-v2.5',
  },
  retail: {
    ...DEFAULT_RULE_CONFIG,
    standardCasePackMin: 6,
    forecastUpperCorridorPct: 100,
    salesOverrideMaxPct: 30,
    minServiceLevelPct: 92,
    maxLeadTimeDays: 30,
    ruleVersion: 'Argon-Retail-v2.5',
  },
  electronics: {
    ...DEFAULT_RULE_CONFIG,
    standardCasePackMin: 4,
    forecastUpperCorridorPct: 60,
    salesOverrideMaxPct: 20,
    minServiceLevelPct: 96,
    maxLeadTimeDays: 45,
    ruleVersion: 'Argon-Electronics-v2.5',
  },
  auto: {
    ...DEFAULT_RULE_CONFIG,
    standardCasePackMin: 10,
    forecastUpperCorridorPct: 70,
    salesOverrideMaxPct: 20,
    minServiceLevelPct: 98,
    maxLeadTimeDays: 28,
    ruleVersion: 'Argon-AutoSpares-v2.5',
  },
  chemicals: {
    ...DEFAULT_RULE_CONFIG,
    standardCasePackMin: 20,
    forecastUpperCorridorPct: 65,
    salesOverrideMaxPct: 20,
    minServiceLevelPct: 95,
    maxLeadTimeDays: 35,
    ruleVersion: 'Argon-Chemicals-v2.5',
  },
};

export const TABLE_CONTRACTS: Record<string, TableContract> = {
  '01_Orders_Shipments_History': {
    tableName: '01_Orders_Shipments_History',
    mandatory: true,
    mandatoryColumns: [
      'Period_Date',
      'SKU_Code',
      'Location_DC',
      'Channel_Code',
      'Ordered_Qty_Units',
      'Invoiced_Actual_Qty',
      'Returns_Damaged_Qty',
    ],
    optionalColumns: [
      'Invoice_Line_ID',
      'Net_Realized_Sales_INR',
      'Transaction_Type',
      'Open_Backorder_Qty',
      'Cancelled_Order_Qty',
      'Governed_Imputed_Demand_Qty',
      'Governed_Spike_Status',
    ],
    businessKey: ['Period_Date', 'SKU_Code', 'Location_DC', 'Channel_Code'],
    foreignKeys: [
      { col: 'SKU_Code', targetTable: '09_Product_Master_Hierarchy', targetCol: 'SKU_Code' },
      { col: 'Location_DC', targetTable: '10_Location_Depot_Network', targetCol: 'Location_DC' },
      { col: 'Channel_Code', targetTable: '11_Customer_Channel_Master', targetCol: 'Channel_Code' },
    ],
    columnTypes: {
      Period_Date: 'DATE',
      SKU_Code: 'STRING',
      Location_DC: 'STRING',
      Channel_Code: 'STRING',
      Ordered_Qty_Units: 'NON_NEGATIVE_NUMBER',
      Invoiced_Actual_Qty: 'NUMBER',
      Returns_Damaged_Qty: 'NON_NEGATIVE_NUMBER',
      Net_Realized_Sales_INR: 'NUMBER',
      Open_Backorder_Qty: 'NON_NEGATIVE_NUMBER',
      Cancelled_Order_Qty: 'NON_NEGATIVE_NUMBER',
      Governed_Imputed_Demand_Qty: 'NON_NEGATIVE_NUMBER',
    },
  },
  '02_Forecast_Vintages_Lag': {
    tableName: '02_Forecast_Vintages_Lag',
    mandatory: true,
    mandatoryColumns: [
      'Target_Delivery_Month',
      'SKU_Code',
      'Location_DC',
      'Channel_Code',
      'Stat_Baseline_Unconstrained',
      'Stat_Forecast_Lag1_Qty',
    ],
    optionalColumns: ['Champion_Model_Tag', 'Forecast_Vintage_Date', 'Lag_Horizon'],
    businessKey: ['Target_Delivery_Month', 'SKU_Code', 'Location_DC', 'Channel_Code'],
    foreignKeys: [
      { col: 'SKU_Code', targetTable: '09_Product_Master_Hierarchy', targetCol: 'SKU_Code' },
      { col: 'Location_DC', targetTable: '10_Location_Depot_Network', targetCol: 'Location_DC' },
      { col: 'Channel_Code', targetTable: '11_Customer_Channel_Master', targetCol: 'Channel_Code' },
    ],
    columnTypes: {
      Target_Delivery_Month: 'DATE',
      SKU_Code: 'STRING',
      Location_DC: 'STRING',
      Channel_Code: 'STRING',
      Stat_Baseline_Unconstrained: 'NON_NEGATIVE_NUMBER',
      Stat_Forecast_Lag1_Qty: 'NON_NEGATIVE_NUMBER',
    },
  },
  '03_Commercial_Sales_Inputs': {
    tableName: '03_Commercial_Sales_Inputs',
    mandatory: false,
    mandatoryColumns: [
      'Target_Period',
      'SKU_Code',
      'Location_DC',
      'Field_Sales_Override_Qty',
      'Finance_AOP_Target_Qty',
    ],
    optionalColumns: ['Override_Reason_Code', 'Scenario_Version', 'Channel_Code'],
    businessKey: ['Target_Period', 'SKU_Code', 'Location_DC'],
    foreignKeys: [
      { col: 'SKU_Code', targetTable: '09_Product_Master_Hierarchy', targetCol: 'SKU_Code' },
      { col: 'Location_DC', targetTable: '10_Location_Depot_Network', targetCol: 'Location_DC' },
    ],
    columnTypes: {
      Target_Period: 'DATE',
      SKU_Code: 'STRING',
      Location_DC: 'STRING',
      Field_Sales_Override_Qty: 'NON_NEGATIVE_NUMBER',
      Finance_AOP_Target_Qty: 'NON_NEGATIVE_NUMBER',
    },
  },
  '04_Trade_Promotions_Calendar': {
    tableName: '04_Trade_Promotions_Calendar',
    mandatory: false,
    mandatoryColumns: [
      'Promo_Event_ID',
      'SKU_Code',
      'Location_DC',
      'Promo_Start_Date',
      'Promo_End_Date',
      'Expected_Uplift_Pct',
    ],
    optionalColumns: ['Promo_Campaign_Name', 'Channel_Code', 'Governed_Promo_Overlap_Resolution'],
    businessKey: ['Promo_Event_ID', 'SKU_Code', 'Location_DC', 'Promo_Start_Date'],
    foreignKeys: [
      { col: 'SKU_Code', targetTable: '09_Product_Master_Hierarchy', targetCol: 'SKU_Code' },
      { col: 'Location_DC', targetTable: '10_Location_Depot_Network', targetCol: 'Location_DC' },
    ],
    columnTypes: {
      Promo_Event_ID: 'STRING',
      SKU_Code: 'STRING',
      Location_DC: 'STRING',
      Promo_Start_Date: 'DATE',
      Promo_End_Date: 'DATE',
      Expected_Uplift_Pct: 'NUMBER',
    },
  },
  '05_Festivals_Holidays_Events': {
    tableName: '05_Festivals_Holidays_Events',
    mandatory: false,
    mandatoryColumns: [
      'Festival_Event_Code',
      'Event_Name',
      'Zone_Region_Scope',
      'Festival_Peak_Date',
      'Expected_Festival_Lift_Pct',
    ],
    optionalColumns: [],
    businessKey: ['Festival_Event_Code', 'Zone_Region_Scope', 'Festival_Peak_Date'],
    foreignKeys: [],
    columnTypes: {
      Festival_Event_Code: 'STRING',
      Event_Name: 'STRING',
      Zone_Region_Scope: 'STRING',
      Festival_Peak_Date: 'DATE',
      Expected_Festival_Lift_Pct: 'NUMBER',
    },
  },
  '06_Pricing_Elasticity_Catalog': {
    tableName: '06_Pricing_Elasticity_Catalog',
    mandatory: false,
    mandatoryColumns: [
      'SKU_Code',
      'Channel_Code',
      'Effective_From_Month',
      'Net_Realized_Price_INR',
      'Unit_COGS_INR',
    ],
    optionalColumns: ['Gross_Margin_Pct', 'MOQ_Units', 'Order_Multiple_Qty'],
    businessKey: ['SKU_Code', 'Channel_Code', 'Effective_From_Month'],
    foreignKeys: [
      { col: 'SKU_Code', targetTable: '09_Product_Master_Hierarchy', targetCol: 'SKU_Code' },
      { col: 'Channel_Code', targetTable: '11_Customer_Channel_Master', targetCol: 'Channel_Code' },
    ],
    columnTypes: {
      SKU_Code: 'STRING',
      Channel_Code: 'STRING',
      Effective_From_Month: 'DATE',
      Net_Realized_Price_INR: 'NON_NEGATIVE_NUMBER',
      Unit_COGS_INR: 'NON_NEGATIVE_NUMBER',
      Gross_Margin_Pct: 'NUMBER',
      MOQ_Units: 'NON_NEGATIVE_NUMBER',
      Order_Multiple_Qty: 'NON_NEGATIVE_NUMBER',
    },
  },
  '07_Inventory_Supply_Constraints': {
    tableName: '07_Inventory_Supply_Constraints',
    mandatory: false,
    mandatoryColumns: [
      'Period_Date',
      'SKU_Code',
      'Location_DC',
      'Closing_OnHand_Stock_Qty',
      'Depot_Stockout_Days_Count',
    ],
    optionalColumns: [
      'Invoiced_Actual_Qty',
      'Governed_Uncensored_Demand_Qty',
      'MOQ_Units',
      'Order_Multiple_Qty',
      'Replenishment_Order_Qty',
      'Yield_Pct',
      'Scrap_Factor_Pct',
      'Min_Safety_Stock_Qty',
      'Max_Inventory_Cap_Qty',
    ],
    businessKey: ['Period_Date', 'SKU_Code', 'Location_DC'],
    foreignKeys: [
      { col: 'SKU_Code', targetTable: '09_Product_Master_Hierarchy', targetCol: 'SKU_Code' },
      { col: 'Location_DC', targetTable: '10_Location_Depot_Network', targetCol: 'Location_DC' },
    ],
    columnTypes: {
      Period_Date: 'DATE',
      SKU_Code: 'STRING',
      Location_DC: 'STRING',
      Closing_OnHand_Stock_Qty: 'NON_NEGATIVE_NUMBER',
      Depot_Stockout_Days_Count: 'NON_NEGATIVE_NUMBER',
      Invoiced_Actual_Qty: 'NUMBER',
      Governed_Uncensored_Demand_Qty: 'NON_NEGATIVE_NUMBER',
      MOQ_Units: 'NON_NEGATIVE_NUMBER',
      Order_Multiple_Qty: 'NON_NEGATIVE_NUMBER',
      Replenishment_Order_Qty: 'NON_NEGATIVE_NUMBER',
      Yield_Pct: 'NON_NEGATIVE_NUMBER',
      Scrap_Factor_Pct: 'NON_NEGATIVE_NUMBER',
      Min_Safety_Stock_Qty: 'NON_NEGATIVE_NUMBER',
      Max_Inventory_Cap_Qty: 'NON_NEGATIVE_NUMBER',
    },
  },
  '08_Weather_Macro_Indices': {
    tableName: '08_Weather_Macro_Indices',
    mandatory: false,
    mandatoryColumns: ['Period_Date', 'Location_DC', 'Avg_Max_Temp_Celsius'],
    optionalColumns: ['Air_Quality_Index_AQI'],
    businessKey: ['Period_Date', 'Location_DC'],
    foreignKeys: [
      { col: 'Location_DC', targetTable: '10_Location_Depot_Network', targetCol: 'Location_DC' },
    ],
    columnTypes: {
      Period_Date: 'DATE',
      Location_DC: 'STRING',
      Avg_Max_Temp_Celsius: 'NUMBER',
      Air_Quality_Index_AQI: 'NON_NEGATIVE_NUMBER',
    },
  },
  '09_Product_Master_Hierarchy': {
    tableName: '09_Product_Master_Hierarchy',
    mandatory: true,
    mandatoryColumns: [
      'SKU_Code',
      'SKU_Description',
      'Base_UOM',
      'UOM_Conversion_Factor',
    ],
    optionalColumns: ['Brand_Name', 'ABC_XYZ_Segment_Code', 'Governed_Pack_Verified'],
    businessKey: ['SKU_Code'],
    foreignKeys: [],
    columnTypes: {
      SKU_Code: 'STRING',
      SKU_Description: 'STRING',
      Base_UOM: 'STRING',
      UOM_Conversion_Factor: 'NON_NEGATIVE_NUMBER',
    },
  },
  '10_Location_Depot_Network': {
    tableName: '10_Location_Depot_Network',
    mandatory: true,
    mandatoryColumns: [
      'Location_DC',
      'Depot_Facility_Name',
      'Commercial_Zone',
      'Primary_Transit_Lead_Time_Days',
    ],
    optionalColumns: ['Lead_Time_StdDev_Days', 'Holding_Cost_Pct_Annual'],
    businessKey: ['Location_DC'],
    foreignKeys: [],
    columnTypes: {
      Location_DC: 'STRING',
      Depot_Facility_Name: 'STRING',
      Commercial_Zone: 'STRING',
      Primary_Transit_Lead_Time_Days: 'NON_NEGATIVE_NUMBER',
      Lead_Time_StdDev_Days: 'NON_NEGATIVE_NUMBER',
      Holding_Cost_Pct_Annual: 'NON_NEGATIVE_NUMBER',
    },
  },
  '11_Customer_Channel_Master': {
    tableName: '11_Customer_Channel_Master',
    mandatory: true,
    mandatoryColumns: [
      'Customer_Account_ID',
      'Customer_Legal_Name',
      'Channel_Code',
      'Contracted_OTIF_SLA_Pct',
    ],
    optionalColumns: [],
    businessKey: ['Customer_Account_ID', 'Channel_Code'],
    foreignKeys: [],
    columnTypes: {
      Customer_Account_ID: 'STRING',
      Customer_Legal_Name: 'STRING',
      Channel_Code: 'STRING',
      Contracted_OTIF_SLA_Pct: 'NON_NEGATIVE_NUMBER',
    },
  },
  '12_NPI_Lifecycle_Transitions': {
    tableName: '12_NPI_Lifecycle_Transitions',
    mandatory: false,
    mandatoryColumns: [
      'New_Launch_SKU_Code',
      'Reference_Analog_SKU_Code',
      'Commercial_Launch_Date',
      'Initial_Trade_Pipeline_Qty',
    ],
    optionalColumns: [],
    businessKey: ['New_Launch_SKU_Code', 'Commercial_Launch_Date'],
    foreignKeys: [
      {
        col: 'Reference_Analog_SKU_Code',
        targetTable: '09_Product_Master_Hierarchy',
        targetCol: 'SKU_Code',
      },
    ],
    columnTypes: {
      New_Launch_SKU_Code: 'STRING',
      Reference_Analog_SKU_Code: 'STRING',
      Commercial_Launch_Date: 'DATE',
      Initial_Trade_Pipeline_Qty: 'NON_NEGATIVE_NUMBER',
    },
  },
  '13_Supplier_Sourcing_Contracts': {
    tableName: '13_Supplier_Sourcing_Contracts',
    mandatory: false,
    mandatoryColumns: [
      'Supplier_ID',
      'SKU_Code',
      'Location_DC',
      'Supplier_Lead_Time_Days',
      'MOQ_Units',
      'Order_Multiple_Qty',
      'Unit_Purchase_Cost_INR',
    ],
    optionalColumns: ['Contract_Valid_From', 'Contract_Valid_To'],
    businessKey: ['Supplier_ID', 'SKU_Code', 'Location_DC'],
    foreignKeys: [
      { col: 'SKU_Code', targetTable: '09_Product_Master_Hierarchy', targetCol: 'SKU_Code' },
      { col: 'Location_DC', targetTable: '10_Location_Depot_Network', targetCol: 'Location_DC' },
    ],
    columnTypes: {
      Supplier_ID: 'STRING',
      SKU_Code: 'STRING',
      Location_DC: 'STRING',
      Supplier_Lead_Time_Days: 'NON_NEGATIVE_NUMBER',
      MOQ_Units: 'NON_NEGATIVE_NUMBER',
      Order_Multiple_Qty: 'NON_NEGATIVE_NUMBER',
      Unit_Purchase_Cost_INR: 'NON_NEGATIVE_NUMBER',
      Contract_Valid_From: 'DATE',
      Contract_Valid_To: 'DATE',
    },
    domains: ['SUPPLY', 'PROCUREMENT'],
  },
  '14_Purchase_Orders_Receipts': {
    tableName: '14_Purchase_Orders_Receipts',
    mandatory: false,
    mandatoryColumns: [
      'PO_Number',
      'Period_Date',
      'Supplier_ID',
      'SKU_Code',
      'Location_DC',
      'Ordered_PO_Qty_Units',
      'Received_Qty_Units',
    ],
    optionalColumns: ['Order_UOM'],
    businessKey: ['PO_Number', 'SKU_Code', 'Location_DC'],
    foreignKeys: [
      { col: 'SKU_Code', targetTable: '09_Product_Master_Hierarchy', targetCol: 'SKU_Code' },
      { col: 'Location_DC', targetTable: '10_Location_Depot_Network', targetCol: 'Location_DC' },
    ],
    columnTypes: {
      PO_Number: 'STRING',
      Period_Date: 'DATE',
      Supplier_ID: 'STRING',
      SKU_Code: 'STRING',
      Location_DC: 'STRING',
      Ordered_PO_Qty_Units: 'NON_NEGATIVE_NUMBER',
      Received_Qty_Units: 'NON_NEGATIVE_NUMBER',
    },
    domains: ['SUPPLY', 'PROCUREMENT'],
  },
  '15_Manufacturing_BOM_WorkCenters': {
    tableName: '15_Manufacturing_BOM_WorkCenters',
    mandatory: false,
    mandatoryColumns: [
      'BOM_ID',
      'Parent_SKU_Code',
      'Component_SKU_Code',
      'Location_DC',
      'Work_Center_ID',
      'Component_Qty_Per_Unit',
      'Scrap_Factor_Pct',
      'Yield_Pct',
      'Available_Capacity_Hrs',
      'Required_Run_Hrs',
    ],
    optionalColumns: [],
    businessKey: ['BOM_ID', 'Parent_SKU_Code', 'Component_SKU_Code', 'Location_DC'],
    foreignKeys: [
      { col: 'Parent_SKU_Code', targetTable: '09_Product_Master_Hierarchy', targetCol: 'SKU_Code' },
      { col: 'Location_DC', targetTable: '10_Location_Depot_Network', targetCol: 'Location_DC' },
    ],
    columnTypes: {
      BOM_ID: 'STRING',
      Parent_SKU_Code: 'STRING',
      Component_SKU_Code: 'STRING',
      Location_DC: 'STRING',
      Work_Center_ID: 'STRING',
      Component_Qty_Per_Unit: 'NON_NEGATIVE_NUMBER',
      Scrap_Factor_Pct: 'NON_NEGATIVE_NUMBER',
      Yield_Pct: 'NON_NEGATIVE_NUMBER',
      Available_Capacity_Hrs: 'NON_NEGATIVE_NUMBER',
      Required_Run_Hrs: 'NON_NEGATIVE_NUMBER',
    },
    domains: ['MANUFACTURING'],
  },
  '16_MEIO_Network_Policy_Costs': {
    tableName: '16_MEIO_Network_Policy_Costs',
    mandatory: false,
    mandatoryColumns: [
      'SKU_Code',
      'Location_DC',
      'Echelon_Tier',
      'Holding_Cost_Pct_Annual',
      'Target_Service_Level_Pct',
      'Lead_Time_StdDev_Days',
      'Min_Safety_Stock_Qty',
      'Max_Inventory_Cap_Qty',
    ],
    optionalColumns: [],
    businessKey: ['SKU_Code', 'Location_DC', 'Echelon_Tier'],
    foreignKeys: [
      { col: 'SKU_Code', targetTable: '09_Product_Master_Hierarchy', targetCol: 'SKU_Code' },
      { col: 'Location_DC', targetTable: '10_Location_Depot_Network', targetCol: 'Location_DC' },
    ],
    columnTypes: {
      SKU_Code: 'STRING',
      Location_DC: 'STRING',
      Echelon_Tier: 'STRING',
      Holding_Cost_Pct_Annual: 'NON_NEGATIVE_NUMBER',
      Target_Service_Level_Pct: 'NON_NEGATIVE_NUMBER',
      Lead_Time_StdDev_Days: 'NON_NEGATIVE_NUMBER',
      Min_Safety_Stock_Qty: 'NON_NEGATIVE_NUMBER',
      Max_Inventory_Cap_Qty: 'NON_NEGATIVE_NUMBER',
    },
    domains: ['MEIO'],
  },
};

export function createSeededEnterpriseSheets(): EnterpriseSheets {
  return {
    '01_Orders_Shipments_History': {
      pillar: 'Core Time-Series',
      desc: 'Historical customer orders, shipments, billed invoices, and returns by Period × SKU × Depot × Channel.',
      cols: [
        { col: 'Period_Date', type: 'DATE', key: 'PK', required: true, dataType: 'DATE' },
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Channel_Code', type: 'VARCHAR(16)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Invoice_Line_ID', type: 'VARCHAR(24)', key: 'Attribute', required: false, dataType: 'STRING' },
        { col: 'Ordered_Qty_Units', type: 'NUMERIC', key: 'Measure', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Invoiced_Actual_Qty', type: 'NUMERIC', key: 'Target', required: true, dataType: 'NUMBER' },
        { col: 'Returns_Damaged_Qty', type: 'NUMERIC', key: 'Measure', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Net_Realized_Sales_INR', type: 'CURRENCY', key: 'Measure', required: false, dataType: 'NUMBER' },
      ],
      records: [
        { Period_Date: '2025-05-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1001', Ordered_Qty_Units: 3120, Invoiced_Actual_Qty: 3120, Returns_Damaged_Qty: 18, Net_Realized_Sales_INR: 196500 },
        { Period_Date: '2025-07-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1014', Ordered_Qty_Units: 3240, Invoiced_Actual_Qty: 3240, Returns_Damaged_Qty: 14, Net_Realized_Sales_INR: 204120 },
        { Period_Date: '2025-08-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1028', Ordered_Qty_Units: 3310, Invoiced_Actual_Qty: 3310, Returns_Damaged_Qty: 11, Net_Realized_Sales_INR: 208530 },
        { Period_Date: '2025-09-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1041', Ordered_Qty_Units: 6975, Invoiced_Actual_Qty: 6975, Returns_Damaged_Qty: 42, Net_Realized_Sales_INR: 431800 },
        // Business-key duplicate with different Invoice_Line_ID and Ordered_Qty_Units
        { Period_Date: '2025-09-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1042-DUP', Ordered_Qty_Units: 7020, Invoiced_Actual_Qty: 6975, Returns_Damaged_Qty: 45, Net_Realized_Sales_INR: 431800 },
        // Unclassified negative invoiced actual
        { Period_Date: '2025-06-01', SKU_Code: 'SKU_SNK_02', Location_DC: 'Mumbai', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1055', Ordered_Qty_Units: 1740, Invoiced_Actual_Qty: -410, Returns_Damaged_Qty: 0, Net_Realized_Sales_INR: -34850 },
        // Null invoiced actual
        { Period_Date: '2025-07-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Delhi', Channel_Code: 'MT', Invoice_Line_ID: 'INV-1062', Ordered_Qty_Units: 3180, Invoiced_Actual_Qty: '', Returns_Damaged_Qty: 12, Net_Realized_Sales_INR: 200100 },
        // Unflagged bulk outlier spike
        { Period_Date: '2025-09-01', SKU_Code: 'P401', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1077', Ordered_Qty_Units: 5435, Invoiced_Actual_Qty: 5435, Returns_Damaged_Qty: 10, Net_Realized_Sales_INR: 345000 },
        // Orphan depot
        { Period_Date: '2025-10-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'East_Sub_DC_99', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1089', Ordered_Qty_Units: 2950, Invoiced_Actual_Qty: 2950, Returns_Damaged_Qty: 8, Net_Realized_Sales_INR: 186000 },
        // Orphan SKU & Orphan Channel
        { Period_Date: '2025-10-01', SKU_Code: 'SKU_LEGACY_999', Location_DC: 'Mumbai', Channel_Code: 'B2B_EXP', Invoice_Line_ID: 'INV-1095', Ordered_Qty_Units: 840, Invoiced_Actual_Qty: 840, Returns_Damaged_Qty: 0, Net_Realized_Sales_INR: 54600 },
      ],
    },
    '02_Forecast_Vintages_Lag': {
      pillar: 'Core Time-Series',
      desc: 'Statistical baseline and lagged forecast snapshots (Lag 1 to Lag 12) for FVA and gatekeeper checks.',
      cols: [
        { col: 'Target_Delivery_Month', type: 'DATE', key: 'PK', required: true, dataType: 'DATE' },
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Channel_Code', type: 'VARCHAR(16)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Stat_Baseline_Unconstrained', type: 'NUMERIC', key: 'Measure', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Stat_Forecast_Lag1_Qty', type: 'NUMERIC', key: 'Measure', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Champion_Model_Tag', type: 'VARCHAR(32)', key: 'Attribute', required: false, dataType: 'STRING' },
      ],
      records: [
        { Target_Delivery_Month: '2026-01-01', SKU_Code: 'P401', Location_DC: 'Kolkata', Channel_Code: 'GT', Stat_Baseline_Unconstrained: 2172, Stat_Forecast_Lag1_Qty: 2543, Champion_Model_Tag: 'Argon_Ensemble_v9' },
        { Target_Delivery_Month: '2026-02-01', SKU_Code: 'P401', Location_DC: 'Kolkata', Channel_Code: 'GT', Stat_Baseline_Unconstrained: 2199, Stat_Forecast_Lag1_Qty: 5350, Champion_Model_Tag: 'Argon_Ensemble_v9' },
      ],
    },
    '03_Commercial_Sales_Inputs': {
      pillar: 'Commercial & S&OP',
      desc: 'Field Sales overrides, KAM commits, Marketing promo blocks, and Finance AOP targets.',
      cols: [
        { col: 'Target_Period', type: 'DATE', key: 'PK', required: true, dataType: 'DATE' },
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Field_Sales_Override_Qty', type: 'NUMERIC', key: 'Input', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Finance_AOP_Target_Qty', type: 'NUMERIC', key: 'Target', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Override_Reason_Code', type: 'VARCHAR(32)', key: 'Attribute', required: false, dataType: 'STRING' },
      ],
      records: [
        { Target_Period: '2026-01-01', SKU_Code: 'SKU_BEV_01', Location_DC: 'Delhi', Field_Sales_Override_Qty: 3312, Finance_AOP_Target_Qty: 2500, Override_Reason_Code: '' },
      ],
    },
    '04_Trade_Promotions_Calendar': {
      pillar: 'Commercial & S&OP',
      desc: 'Trade promotion date windows, discount depth %, uplift %, and post-promo dip factors.',
      cols: [
        { col: 'Promo_Event_ID', type: 'VARCHAR(24)', key: 'PK', required: true, dataType: 'STRING' },
        { col: 'Promo_Campaign_Name', type: 'VARCHAR(64)', key: 'Attribute', required: false, dataType: 'STRING' },
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'FK', required: true, dataType: 'STRING' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'FK', required: true, dataType: 'STRING' },
        { col: 'Promo_Start_Date', type: 'DATE', key: 'Date', required: true, dataType: 'DATE' },
        { col: 'Promo_End_Date', type: 'DATE', key: 'Date', required: true, dataType: 'DATE' },
        { col: 'Expected_Uplift_Pct', type: 'PERCENT', key: 'Output', required: true, dataType: 'NUMBER' },
      ],
      records: [
        { Promo_Event_ID: 'PRM_DIW_01', Promo_Campaign_Name: 'Diwali_BOGO', SKU_Code: 'SKU_BEV_01', Location_DC: 'Mumbai', Promo_Start_Date: '2025-10-10', Promo_End_Date: '2025-10-25', Expected_Uplift_Pct: 32 },
        { Promo_Event_ID: 'PRM_Q4_15', Promo_Campaign_Name: 'Q4_Slab_15', SKU_Code: 'SKU_BEV_01', Location_DC: 'Mumbai', Promo_Start_Date: '2025-10-18', Promo_End_Date: '2025-10-30', Expected_Uplift_Pct: 24 },
        { Promo_Event_ID: 'PRM_NOV_99', Promo_Campaign_Name: 'Cyber_Flash', SKU_Code: 'SKU_CARE_04', Location_DC: 'Bengaluru', Promo_Start_Date: '2025-11-25', Promo_End_Date: '2025-11-10', Expected_Uplift_Pct: 28 },
      ],
    },
    '05_Festivals_Holidays_Events': {
      pillar: 'Commercial & S&OP',
      desc: 'Regional festivals, calendar shift offsets, and forward-buy pre-build lead windows.',
      cols: [
        { col: 'Festival_Event_Code', type: 'VARCHAR(24)', key: 'PK', required: true, dataType: 'STRING' },
        { col: 'Event_Name', type: 'VARCHAR(64)', key: 'Attribute', required: true, dataType: 'STRING' },
        { col: 'Zone_Region_Scope', type: 'VARCHAR(24)', key: 'Attribute', required: true, dataType: 'STRING' },
        { col: 'Festival_Peak_Date', type: 'DATE', key: 'Date', required: true, dataType: 'DATE' },
        { col: 'Expected_Festival_Lift_Pct', type: 'PERCENT', key: 'Output', required: true, dataType: 'NUMBER' },
      ],
      records: [
        { Festival_Event_Code: 'FEST_DURGA_PUJA', Event_Name: 'East Durga Puja Wave', Zone_Region_Scope: 'East', Festival_Peak_Date: '2025-10-20', Expected_Festival_Lift_Pct: 24.5 },
      ],
    },
    '06_Pricing_Elasticity_Catalog': {
      pillar: 'Commercial & S&OP',
      desc: 'Unit MRP, net realized price, unit COGS, gross margin %, and price elasticity.',
      cols: [
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Channel_Code', type: 'VARCHAR(16)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Effective_From_Month', type: 'DATE', key: 'PK', required: true, dataType: 'DATE' },
        { col: 'Net_Realized_Price_INR', type: 'CURRENCY', key: 'Measure', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Unit_COGS_INR', type: 'CURRENCY', key: 'Measure', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Gross_Margin_Pct', type: 'PERCENT', key: 'KPI', required: false, dataType: 'NUMBER' },
      ],
      records: [
        { SKU_Code: 'SKU_DAIRY_03', Channel_Code: 'GT', Effective_From_Month: '2025-12-01', Net_Realized_Price_INR: 65, Unit_COGS_INR: 72, Gross_Margin_Pct: -10.8 },
        { SKU_Code: 'SKU_BEV_01', Channel_Code: 'GT', Effective_From_Month: '2025-12-01', Net_Realized_Price_INR: 114, Unit_COGS_INR: 69.6, Gross_Margin_Pct: 42.0 },
      ],
    },
    '07_Inventory_Supply_Constraints': {
      pillar: 'Supply & External Drivers',
      desc: 'Opening/closing depot stock, stockout days, lost sales, and factory allocation caps.',
      cols: [
        { col: 'Period_Date', type: 'DATE', key: 'PK', required: true, dataType: 'DATE' },
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Closing_OnHand_Stock_Qty', type: 'NUMERIC', key: 'Measure', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Depot_Stockout_Days_Count', type: 'INTEGER', key: 'Constraint', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Invoiced_Actual_Qty', type: 'NUMERIC', key: 'Measure', required: false, dataType: 'NUMBER' },
      ],
      records: [
        { Period_Date: '2025-05-01', SKU_Code: 'SKU_SNK_02', Location_DC: 'Kolkata', Closing_OnHand_Stock_Qty: 0, Depot_Stockout_Days_Count: 6, Invoiced_Actual_Qty: 1420 },
        { Period_Date: '2025-08-01', SKU_Code: 'SKU_SNK_02', Location_DC: 'Delhi', Closing_OnHand_Stock_Qty: 0, Depot_Stockout_Days_Count: 5, Invoiced_Actual_Qty: 1510 },
      ],
    },
    '08_Weather_Macro_Indices': {
      pillar: 'Supply & External Drivers',
      desc: 'Temperature anomalies, rainfall, AQI pollution index, and category inflation.',
      cols: [
        { col: 'Period_Date', type: 'DATE', key: 'PK', required: true, dataType: 'DATE' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Avg_Max_Temp_Celsius', type: 'NUMERIC', key: 'Driver', required: true, dataType: 'NUMBER' },
        { col: 'Air_Quality_Index_AQI', type: 'INTEGER', key: 'Driver', required: false, dataType: 'NON_NEGATIVE_NUMBER' },
      ],
      records: [
        { Period_Date: '2025-05-01', Location_DC: 'Delhi', Avg_Max_Temp_Celsius: 41.2, Air_Quality_Index_AQI: 245 },
      ],
    },
    '09_Product_Master_Hierarchy': {
      pillar: 'Master Dimensions',
      desc: 'SKU master attributes, brand hierarchy, UOM conversion factors, and ABC-XYZ segments.',
      cols: [
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK', required: true, dataType: 'STRING' },
        { col: 'SKU_Description', type: 'VARCHAR(96)', key: 'Attribute', required: true, dataType: 'STRING' },
        { col: 'Brand_Name', type: 'VARCHAR(32)', key: 'Hierarchy', required: false, dataType: 'STRING' },
        { col: 'Base_UOM', type: 'VARCHAR(16)', key: 'Attribute', required: true, dataType: 'STRING' },
        { col: 'UOM_Conversion_Factor', type: 'INTEGER', key: 'Conversion', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'ABC_XYZ_Segment_Code', type: 'CHAR(2)', key: 'Class', required: false, dataType: 'STRING' },
      ],
      records: [
        { SKU_Code: 'SKU_DAIRY_03', SKU_Description: 'PureFarm Dairy 1L', Brand_Name: 'PureFarm', Base_UOM: 'EA', UOM_Conversion_Factor: 12, ABC_XYZ_Segment_Code: 'AX' },
        { SKU_Code: 'SKU_BEV_01', SKU_Description: 'AuraBev Drinks 500ml', Brand_Name: 'AuraBev', Base_UOM: 'CASE', UOM_Conversion_Factor: 1, ABC_XYZ_Segment_Code: 'AY' },
        { SKU_Code: 'SKU_SNK_02', SKU_Description: 'CrunchCo Snacks 150g', Brand_Name: 'CrunchCo', Base_UOM: 'EA', UOM_Conversion_Factor: 24, ABC_XYZ_Segment_Code: 'BX' },
        { SKU_Code: 'SKU_CARE_04', SKU_Description: 'GlowLab Care 200ml', Brand_Name: 'GlowLab', Base_UOM: 'EA', UOM_Conversion_Factor: 12, ABC_XYZ_Segment_Code: 'BY' },
        { SKU_Code: 'P401', SKU_Description: 'Dune Core Pack 500g', Brand_Name: 'Dune', Base_UOM: 'EA', UOM_Conversion_Factor: 12, ABC_XYZ_Segment_Code: 'AZ' },
      ],
    },
    '10_Location_Depot_Network': {
      pillar: 'Master Dimensions',
      desc: 'Regional Depots, Mother Hubs, commercial zones, and replenishment lead times.',
      cols: [
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK', required: true, dataType: 'STRING' },
        { col: 'Depot_Facility_Name', type: 'VARCHAR(64)', key: 'Attribute', required: true, dataType: 'STRING' },
        { col: 'Commercial_Zone', type: 'VARCHAR(24)', key: 'Hierarchy', required: true, dataType: 'STRING' },
        { col: 'Primary_Transit_Lead_Time_Days', type: 'INTEGER', key: 'Parameter', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
      ],
      records: [
        { Location_DC: 'Kolkata', Depot_Facility_Name: 'East Mother Hub Kolkata', Commercial_Zone: 'East', Primary_Transit_Lead_Time_Days: 4 },
        { Location_DC: 'Delhi', Depot_Facility_Name: 'North Mother Hub Delhi', Commercial_Zone: 'North', Primary_Transit_Lead_Time_Days: 3 },
        { Location_DC: 'Mumbai', Depot_Facility_Name: 'West Mother Hub Mumbai', Commercial_Zone: 'West', Primary_Transit_Lead_Time_Days: 3 },
        { Location_DC: 'Bengaluru', Depot_Facility_Name: 'South Mother Hub Bengaluru', Commercial_Zone: 'South', Primary_Transit_Lead_Time_Days: 4 },
      ],
    },
    '11_Customer_Channel_Master': {
      pillar: 'Master Dimensions',
      desc: 'General Trade distributors, Modern Trade chains, E-Com accounts, and OTIF SLAs.',
      cols: [
        { col: 'Customer_Account_ID', type: 'VARCHAR(24)', key: 'PK', required: true, dataType: 'STRING' },
        { col: 'Customer_Legal_Name', type: 'VARCHAR(64)', key: 'Attribute', required: true, dataType: 'STRING' },
        { col: 'Channel_Code', type: 'VARCHAR(16)', key: 'Hierarchy', required: true, dataType: 'STRING' },
        { col: 'Contracted_OTIF_SLA_Pct', type: 'PERCENT', key: 'Target', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
      ],
      records: [
        { Customer_Account_ID: 'KA_EAST_01', Customer_Legal_Name: 'East Super-Stockist Pvt Ltd', Channel_Code: 'GT', Contracted_OTIF_SLA_Pct: 98.0 },
        { Customer_Account_ID: 'KA_NORTH_02', Customer_Legal_Name: 'Metro Modern Trade Chain', Channel_Code: 'MT', Contracted_OTIF_SLA_Pct: 97.5 },
      ],
    },
    '12_NPI_Lifecycle_Transitions': {
      pillar: 'Master Dimensions',
      desc: 'New Product Introductions, reference look-alike SKUs, pipeline fill, and cannibalization rates.',
      cols: [
        { col: 'New_Launch_SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Reference_Analog_SKU_Code', type: 'VARCHAR(32)', key: 'FK', required: true, dataType: 'STRING' },
        { col: 'Commercial_Launch_Date', type: 'DATE', key: 'Date', required: true, dataType: 'DATE' },
        { col: 'Initial_Trade_Pipeline_Qty', type: 'NUMERIC', key: 'Input', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
      ],
      records: [
        { New_Launch_SKU_Code: 'SKU_CARE_04_NEW', Reference_Analog_SKU_Code: '', Commercial_Launch_Date: '2026-01-15', Initial_Trade_Pipeline_Qty: 1800 },
      ],
    },
  };
}

/**
 * Builds a domain-specific test workbook containing only the relevant tables for the selected domain
 * plus domain-specific extension tables (13_Supplier_Sourcing_Contracts, 14_Purchase_Orders_Receipts,
 * 15_Manufacturing_BOM_WorkCenters, 16_MEIO_Network_Policy_Costs).
 */
export function createDomainTestWorkbook(domain: PlanningDomainKey): EnterpriseSheets {
  const base = createSeededEnterpriseSheets();
  const domainExtensionTables: EnterpriseSheets = {
    '13_Supplier_Sourcing_Contracts': {
      pillar: 'Procurement & Sourcing',
      desc: 'Approved vendor contracts, supplier lead times, MOQs, order multiples, and purchase costs.',
      cols: [
        { col: 'Supplier_ID', type: 'VARCHAR(24)', key: 'PK', required: true, dataType: 'STRING' },
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Supplier_Lead_Time_Days', type: 'INTEGER', key: 'Parameter', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'MOQ_Units', type: 'NUMERIC', key: 'Constraint', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Order_Multiple_Qty', type: 'NUMERIC', key: 'Constraint', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Unit_Purchase_Cost_INR', type: 'CURRENCY', key: 'Measure', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
      ],
      records: [
        { Supplier_ID: 'SUP_PACK_01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Supplier_Lead_Time_Days: 12, MOQ_Units: 500, Order_Multiple_Qty: 100, Unit_Purchase_Cost_INR: 48 },
        { Supplier_ID: 'SUP_BEV_02', SKU_Code: 'SKU_BEV_01', Location_DC: 'Mumbai', Supplier_Lead_Time_Days: 45, MOQ_Units: 1000, Order_Multiple_Qty: 250, Unit_Purchase_Cost_INR: 62 },
      ],
    },
    '14_Purchase_Orders_Receipts': {
      pillar: 'Procurement & Sourcing',
      desc: 'Open and received purchase orders by PO Number × SKU × Depot with MOQ & multiple compliance checks.',
      cols: [
        { col: 'PO_Number', type: 'VARCHAR(24)', key: 'PK', required: true, dataType: 'STRING' },
        { col: 'Period_Date', type: 'DATE', key: 'Date', required: true, dataType: 'DATE' },
        { col: 'Supplier_ID', type: 'VARCHAR(24)', key: 'FK', required: true, dataType: 'STRING' },
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Ordered_PO_Qty_Units', type: 'NUMERIC', key: 'Measure', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Received_Qty_Units', type: 'NUMERIC', key: 'Measure', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
      ],
      records: [
        { PO_Number: 'PO-2025-901', Period_Date: '2025-09-01', Supplier_ID: 'SUP_PACK_01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Ordered_PO_Qty_Units: 600, Received_Qty_Units: 600 },
        { PO_Number: 'PO-2025-902', Period_Date: '2025-09-15', Supplier_ID: 'SUP_BEV_02', SKU_Code: 'SKU_BEV_01', Location_DC: 'Mumbai', Ordered_PO_Qty_Units: 450, Received_Qty_Units: 450 },
      ],
    },
    '15_Manufacturing_BOM_WorkCenters': {
      pillar: 'Manufacturing & Production',
      desc: 'Bill of Materials parent-component structure, work-center run hours, scrap factors, and yield %.',
      cols: [
        { col: 'BOM_ID', type: 'VARCHAR(24)', key: 'PK', required: true, dataType: 'STRING' },
        { col: 'Parent_SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Component_SKU_Code', type: 'VARCHAR(32)', key: 'PK', required: true, dataType: 'STRING' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Work_Center_ID', type: 'VARCHAR(24)', key: 'Attribute', required: true, dataType: 'STRING' },
        { col: 'Component_Qty_Per_Unit', type: 'NUMERIC', key: 'Measure', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Scrap_Factor_Pct', type: 'PERCENT', key: 'Parameter', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Yield_Pct', type: 'PERCENT', key: 'Parameter', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Available_Capacity_Hrs', type: 'NUMERIC', key: 'Constraint', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Required_Run_Hrs', type: 'NUMERIC', key: 'Measure', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
      ],
      records: [
        { BOM_ID: 'BOM-DAIRY-01', Parent_SKU_Code: 'SKU_DAIRY_03', Component_SKU_Code: 'RAW_MILK_01', Location_DC: 'Kolkata', Work_Center_ID: 'WC_PAST_01', Component_Qty_Per_Unit: 1.05, Scrap_Factor_Pct: 2.5, Yield_Pct: 97.5, Available_Capacity_Hrs: 160, Required_Run_Hrs: 140 },
        { BOM_ID: 'BOM-SNK-02', Parent_SKU_Code: 'SKU_SNK_02', Component_SKU_Code: 'RAW_GRAIN_02', Location_DC: 'Mumbai', Work_Center_ID: 'WC_EXTR_02', Component_Qty_Per_Unit: 1.12, Scrap_Factor_Pct: 15, Yield_Pct: 108, Available_Capacity_Hrs: 120, Required_Run_Hrs: 145 },
      ],
    },
    '16_MEIO_Network_Policy_Costs': {
      pillar: 'Multi-Echelon Inventory (MEIO)',
      desc: 'Echelon holding cost %, service level targets, lead-time variability, and safety stock min/max corridors.',
      cols: [
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK', required: true, dataType: 'STRING' },
        { col: 'Echelon_Tier', type: 'VARCHAR(24)', key: 'PK', required: true, dataType: 'STRING' },
        { col: 'Holding_Cost_Pct_Annual', type: 'PERCENT', key: 'Parameter', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Target_Service_Level_Pct', type: 'PERCENT', key: 'Target', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Lead_Time_StdDev_Days', type: 'NUMERIC', key: 'Parameter', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Min_Safety_Stock_Qty', type: 'NUMERIC', key: 'Constraint', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
        { col: 'Max_Inventory_Cap_Qty', type: 'NUMERIC', key: 'Constraint', required: true, dataType: 'NON_NEGATIVE_NUMBER' },
      ],
      records: [
        { SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Echelon_Tier: 'MOTHER_HUB', Holding_Cost_Pct_Annual: 18.5, Target_Service_Level_Pct: 98.0, Lead_Time_StdDev_Days: 1.2, Min_Safety_Stock_Qty: 450, Max_Inventory_Cap_Qty: 2400 },
        { SKU_Code: 'SKU_SNK_02', Location_DC: 'Delhi', Echelon_Tier: 'REGIONAL_DC', Holding_Cost_Pct_Annual: 22.0, Target_Service_Level_Pct: 96.0, Lead_Time_StdDev_Days: 1.8, Min_Safety_Stock_Qty: 1800, Max_Inventory_Cap_Qty: 1200 },
      ],
    },
  };

  if (domain === 'ALL') {
    return { ...base, ...domainExtensionTables };
  }

  const contract = DOMAIN_CONTRACTS[domain];
  const combined = { ...base, ...domainExtensionTables };
  const result: EnterpriseSheets = {};
  for (const tblName of contract.relevantTables) {
    if (combined[tblName]) {
      result[tblName] = combined[tblName];
    }
  }
  return result;
}
