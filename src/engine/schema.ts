import { EnterpriseSheets, IndustryKey } from './types';

export const INDUSTRY_LABELS: Record<IndustryKey, string> = {
  cpg: 'FMCG & Beverages',
  pharma: 'Pharma & Healthcare',
  retail: 'Fashion & Retail',
  electronics: 'Consumer Electronics',
  auto: 'Automotive Spares',
  chemicals: 'Paints, Chemicals & Agri',
};

export function createSeededEnterpriseSheets(): EnterpriseSheets {
  return {
    '01_Orders_Shipments_History': {
      pillar: 'Core Time-Series',
      desc: 'Historical customer orders, shipments, billed invoices, and returns by Period × SKU × Depot × Channel.',
      cols: [
        { col: 'Period_Date', type: 'DATE', key: 'PK' },
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK' },
        { col: 'Channel_Code', type: 'VARCHAR(16)', key: 'PK / FK' },
        { col: 'Invoice_Line_ID', type: 'VARCHAR(24)', key: 'Attribute' },
        { col: 'Ordered_Qty_Units', type: 'NUMERIC', key: 'Measure' },
        { col: 'Invoiced_Actual_Qty', type: 'NUMERIC', key: 'Target' },
        { col: 'Returns_Damaged_Qty', type: 'NUMERIC', key: 'Measure' },
        { col: 'Net_Realized_Sales_INR', type: 'CURRENCY', key: 'Measure' },
      ],
      records: [
        // Continuous series with missing 2025-06-01 period gap for SKU_DAIRY_03 / Kolkata / GT
        { Period_Date: '2025-05-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1001', Ordered_Qty_Units: 3120, Invoiced_Actual_Qty: 3120, Returns_Damaged_Qty: 18, Net_Realized_Sales_INR: 196500 },
        { Period_Date: '2025-07-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1014', Ordered_Qty_Units: 3240, Invoiced_Actual_Qty: 3240, Returns_Damaged_Qty: 14, Net_Realized_Sales_INR: 204120 },
        { Period_Date: '2025-08-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1028', Ordered_Qty_Units: 3310, Invoiced_Actual_Qty: 3310, Returns_Damaged_Qty: 11, Net_Realized_Sales_INR: 208530 },
        { Period_Date: '2025-09-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1041', Ordered_Qty_Units: 6975, Invoiced_Actual_Qty: 6975, Returns_Damaged_Qty: 42, Net_Realized_Sales_INR: 431800 },
        // Business-key duplicate: same Period × SKU × Depot × Channel, different Invoice_Line_ID & Ordered_Qty_Units
        { Period_Date: '2025-09-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1042-DUP', Ordered_Qty_Units: 7020, Invoiced_Actual_Qty: 6975, Returns_Damaged_Qty: 45, Net_Realized_Sales_INR: 431800 },
        // Negative invoiced actual without credit return separation
        { Period_Date: '2025-06-01', SKU_Code: 'SKU_SNK_02', Location_DC: 'Mumbai', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1055', Ordered_Qty_Units: 1740, Invoiced_Actual_Qty: -410, Returns_Damaged_Qty: 0, Net_Realized_Sales_INR: -34850 },
        // Null invoiced actual
        { Period_Date: '2025-07-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'Delhi', Channel_Code: 'MT', Invoice_Line_ID: 'INV-1062', Ordered_Qty_Units: 3180, Invoiced_Actual_Qty: '', Returns_Damaged_Qty: 12, Net_Realized_Sales_INR: 200100 },
        // Unflagged spike on P401
        { Period_Date: '2025-09-01', SKU_Code: 'P401', Location_DC: 'Kolkata', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1077', Ordered_Qty_Units: 5435, Invoiced_Actual_Qty: 5435, Returns_Damaged_Qty: 10, Net_Realized_Sales_INR: 345000 },
        // Cross-table orphan Location_DC (East_Sub_DC_99)
        { Period_Date: '2025-10-01', SKU_Code: 'SKU_DAIRY_03', Location_DC: 'East_Sub_DC_99', Channel_Code: 'GT', Invoice_Line_ID: 'INV-1089', Ordered_Qty_Units: 2950, Invoiced_Actual_Qty: 2950, Returns_Damaged_Qty: 8, Net_Realized_Sales_INR: 186000 },
        // Cross-table orphan SKU_Code (SKU_LEGACY_999) + orphan Channel_Code (B2B_EXP)
        { Period_Date: '2025-10-01', SKU_Code: 'SKU_LEGACY_999', Location_DC: 'Mumbai', Channel_Code: 'B2B_EXP', Invoice_Line_ID: 'INV-1095', Ordered_Qty_Units: 840, Invoiced_Actual_Qty: 840, Returns_Damaged_Qty: 0, Net_Realized_Sales_INR: 54600 },
      ],
    },
    '02_Forecast_Vintages_Lag': {
      pillar: 'Core Time-Series',
      desc: 'Statistical baseline and lagged forecast snapshots (Lag 1 to Lag 12) for FVA and gatekeeper checks.',
      cols: [
        { col: 'Target_Delivery_Month', type: 'DATE', key: 'PK' },
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK' },
        { col: 'Channel_Code', type: 'VARCHAR(16)', key: 'PK / FK' },
        { col: 'Stat_Baseline_Unconstrained', type: 'NUMERIC', key: 'Measure' },
        { col: 'Stat_Forecast_Lag1_Qty', type: 'NUMERIC', key: 'Measure' },
        { col: 'Champion_Model_Tag', type: 'VARCHAR(32)', key: 'Attribute' },
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
        { col: 'Target_Period', type: 'DATE', key: 'PK' },
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK' },
        { col: 'Field_Sales_Override_Qty', type: 'NUMERIC', key: 'Input' },
        { col: 'Finance_AOP_Target_Qty', type: 'NUMERIC', key: 'Target' },
        { col: 'Override_Reason_Code', type: 'VARCHAR(32)', key: 'Attribute' },
      ],
      records: [
        { Target_Period: '2026-01-01', SKU_Code: 'SKU_BEV_01', Location_DC: 'Delhi', Field_Sales_Override_Qty: 3312, Finance_AOP_Target_Qty: 2500, Override_Reason_Code: '' },
      ],
    },
    '04_Trade_Promotions_Calendar': {
      pillar: 'Commercial & S&OP',
      desc: 'Trade promotion date windows, discount depth %, uplift %, and post-promo dip factors.',
      cols: [
        { col: 'Promo_Event_ID', type: 'VARCHAR(24)', key: 'PK' },
        { col: 'Promo_Campaign_Name', type: 'VARCHAR(64)', key: 'Attribute' },
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'FK' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'FK' },
        { col: 'Promo_Start_Date', type: 'DATE', key: 'Date' },
        { col: 'Promo_End_Date', type: 'DATE', key: 'Date' },
        { col: 'Expected_Uplift_Pct', type: 'PERCENT', key: 'Output' },
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
        { col: 'Festival_Event_Code', type: 'VARCHAR(24)', key: 'PK' },
        { col: 'Event_Name', type: 'VARCHAR(64)', key: 'Attribute' },
        { col: 'Zone_Region_Scope', type: 'VARCHAR(24)', key: 'Attribute' },
        { col: 'Festival_Peak_Date', type: 'DATE', key: 'Date' },
        { col: 'Expected_Festival_Lift_Pct', type: 'PERCENT', key: 'Output' },
      ],
      records: [
        { Festival_Event_Code: 'FEST_DURGA_PUJA', Event_Name: 'East Durga Puja Wave', Zone_Region_Scope: 'East', Festival_Peak_Date: '2025-10-20', Expected_Festival_Lift_Pct: 24.5 },
      ],
    },
    '06_Pricing_Elasticity_Catalog': {
      pillar: 'Commercial & S&OP',
      desc: 'Unit MRP, net realized price, unit COGS, gross margin %, and price elasticity.',
      cols: [
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK' },
        { col: 'Channel_Code', type: 'VARCHAR(16)', key: 'PK / FK' },
        { col: 'Effective_From_Month', type: 'DATE', key: 'PK' },
        { col: 'Net_Realized_Price_INR', type: 'CURRENCY', key: 'Measure' },
        { col: 'Unit_COGS_INR', type: 'CURRENCY', key: 'Measure' },
        { col: 'Gross_Margin_Pct', type: 'PERCENT', key: 'KPI' },
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
        { col: 'Period_Date', type: 'DATE', key: 'PK' },
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK' },
        { col: 'Closing_OnHand_Stock_Qty', type: 'NUMERIC', key: 'Measure' },
        { col: 'Depot_Stockout_Days_Count', type: 'INTEGER', key: 'Constraint' },
        { col: 'Invoiced_Actual_Qty', type: 'NUMERIC', key: 'Measure' },
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
        { col: 'Period_Date', type: 'DATE', key: 'PK' },
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK / FK' },
        { col: 'Avg_Max_Temp_Celsius', type: 'NUMERIC', key: 'Driver' },
        { col: 'Air_Quality_Index_AQI', type: 'INTEGER', key: 'Driver' },
      ],
      records: [
        { Period_Date: '2025-05-01', Location_DC: 'Delhi', Avg_Max_Temp_Celsius: 41.2, Air_Quality_Index_AQI: 245 },
      ],
    },
    '09_Product_Master_Hierarchy': {
      pillar: 'Master Dimensions',
      desc: 'SKU master attributes, brand hierarchy, UOM conversion factors, and ABC-XYZ segments.',
      cols: [
        { col: 'SKU_Code', type: 'VARCHAR(32)', key: 'PK' },
        { col: 'SKU_Description', type: 'VARCHAR(96)', key: 'Attribute' },
        { col: 'Brand_Name', type: 'VARCHAR(32)', key: 'Hierarchy' },
        { col: 'Base_UOM', type: 'VARCHAR(16)', key: 'Attribute' },
        { col: 'UOM_Conversion_Factor', type: 'INTEGER', key: 'Conversion' },
        { col: 'ABC_XYZ_Segment_Code', type: 'CHAR(2)', key: 'Class' },
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
        { col: 'Location_DC', type: 'VARCHAR(24)', key: 'PK' },
        { col: 'Depot_Facility_Name', type: 'VARCHAR(64)', key: 'Attribute' },
        { col: 'Commercial_Zone', type: 'VARCHAR(24)', key: 'Hierarchy' },
        { col: 'Primary_Transit_Lead_Time_Days', type: 'INTEGER', key: 'Parameter' },
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
        { col: 'Customer_Account_ID', type: 'VARCHAR(24)', key: 'PK' },
        { col: 'Customer_Legal_Name', type: 'VARCHAR(64)', key: 'Attribute' },
        { col: 'Channel_Code', type: 'VARCHAR(16)', key: 'Hierarchy' },
        { col: 'Contracted_OTIF_SLA_Pct', type: 'PERCENT', key: 'Target' },
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
        { col: 'New_Launch_SKU_Code', type: 'VARCHAR(32)', key: 'PK / FK' },
        { col: 'Reference_Analog_SKU_Code', type: 'VARCHAR(32)', key: 'FK' },
        { col: 'Commercial_Launch_Date', type: 'DATE', key: 'Date' },
        { col: 'Initial_Trade_Pipeline_Qty', type: 'NUMERIC', key: 'Input' },
      ],
      records: [
        { New_Launch_SKU_Code: 'SKU_CARE_04_NEW', Reference_Analog_SKU_Code: '', Commercial_Launch_Date: '2026-01-15', Initial_Trade_Pipeline_Qty: 1800 },
      ],
    },
  };
}
