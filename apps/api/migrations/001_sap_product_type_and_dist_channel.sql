-- ============================================================================
-- Migration 001: SAP Reference Tables
-- SAP_Product_Type_MMKDS + SAP_Distribution_Channel_SDKDS
-- Run against: icsoft database
-- ============================================================================

-- ---- 1. Product Type (Material Type / MMKDS) ----------------------------

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'SAP_Product_Type_MMKDS')
BEGIN
  CREATE TABLE SAP_Product_Type_MMKDS (
    Id                          INT IDENTITY(1,1) PRIMARY KEY,
    MaterialTypeCode            VARCHAR(10) NOT NULL,
    Description                 VARCHAR(100) NOT NULL,
    [25Char]                    VARCHAR(25) NULL,
    QuantityUpdate              VARCHAR(10) NOT NULL DEFAULT 'Yes',
    ValueUpdate                 VARCHAR(20) NOT NULL DEFAULT 'Yes',
    QualityInspection           VARCHAR(10) NOT NULL DEFAULT 'Yes',
    BatchManagement             VARCHAR(10) NOT NULL DEFAULT 'Yes',
    NoRangeFrom                 BIGINT NULL,
    NoRangeTo                   BIGINT NULL,
    ValuationClass              VARCHAR(20) NULL,
    Icsoft_Product_Type_Mapping VARCHAR(100) NULL,
    Active                      CHAR(1) NOT NULL DEFAULT 'Y',
    CreatedAt                   DATETIME NOT NULL DEFAULT GETDATE(),
    UpdatedAt                   DATETIME NOT NULL DEFAULT GETDATE()
  );

  INSERT INTO SAP_Product_Type_MMKDS
    (MaterialTypeCode, Description, QuantityUpdate, ValueUpdate, QualityInspection, BatchManagement, NoRangeFrom, NoRangeTo, ValuationClass)
  VALUES
    ('ZFGM', 'FINISHED GOODS',                'Yes', 'Yes',         'Yes', 'Yes', NULL,       NULL,       '7920'),
    ('ZSFG', 'SEMI FINISHED GOODS',           'Yes', 'Yes',         'Yes', 'Yes', NULL,       NULL,       '7900'),
    ('ZRAW', 'RAW MATERIAL',                  'Yes', 'Yes',         'Yes', 'Yes', 1000000000, 1099999999, '3000'),
    ('ZPKG', 'PACKAGING MATERIAL',            'Yes', 'Yes',         'Yes', 'Yes', 1100000000, 1199999999, '3050'),
    ('ZSPT', 'SPARES',                        'Yes', 'Yes',         'Yes', 'Yes', 1200000000, 1299999999, '3040'),
    ('ZCON', 'CONSUMABLES',                   'Yes', 'Yes',         'No',  'Yes', 1300000000, 1399999999, NULL),
    ('ZSRV', 'SERVICES',                      'No',  'Non Valued',  'No',  'No',  1500000000, 1599999999, NULL),
    ('ZSCP', 'SCRAP',                         'Yes', 'Non Valued',  'No',  'No',  1600000000, 1699999999, NULL),
    ('ZCAP', 'FIXED ASSETS',                  'Yes', 'Non Valued',  'No',  'No',  1700000000, 1799999999, NULL),
    ('ZPAT', 'PATTERN & COREBOX (PRODUCT)',   'Yes', 'Non Valued',  'Yes', 'No',  NULL,       NULL,       NULL),
    ('ZEMP', 'EMPTIES (RETURNABLES)',         'Yes', 'Non Valued',  'No',  'No',  1800000000, 1899999999, NULL),
    ('ZBYP', 'BY-PRODUCT',                   'Yes', 'Non Valued',  'No',  'No',  1900000000, 1999999999, NULL),
    ('ZCOP', 'CO-PRODUCTS (GENERAL)',         'Yes', 'Yes',         'Yes', 'No',  1400000000, 1499999999, NULL),
    ('ZFRT', 'FOUNDRY RETURN (CO-PROD)',      'Yes', 'Yes',         'Yes', 'Yes', 1400000000, 1499999999, NULL),
    ('ZBRG', 'BORING SCRAP (CO-PROD)',        'Yes', 'Yes',         'Yes', 'Yes', 1400000000, 1499999999, NULL),
    ('ZPRT', 'PRT ASSETS',                   'Yes', 'Non Valued',  'Yes', 'Yes', 2000000000, 2099999999, NULL),
    ('ZPRA', 'PRT REGULAR',                  'Yes', 'Yes',         'Yes', 'Yes', 2100000000, 2199999999, NULL),
    ('ZCMP', 'COMBINED PRODUCT',             'YES', 'YES',         'YES', 'YES', 2200000000, 2299999999, NULL),
    ('ZINP', 'INTERNAL PRODUCT',             'YES', 'YES',         'YES', 'YES', 2300000000, 2399999999, NULL);

  PRINT 'Created and seeded SAP_Product_Type_MMKDS (19 rows)';
END
ELSE
BEGIN
  PRINT 'SAP_Product_Type_MMKDS already exists — skipping';
END;

-- ---- 2. Distribution Channel (SDKDS) -----------------------------------

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'SAP_Distribution_Channel_SDKDS')
BEGIN
  CREATE TABLE SAP_Distribution_Channel_SDKDS (
    Id                            INT IDENTITY(1,1) PRIMARY KEY,
    DistributionChannelCode       VARCHAR(10) NOT NULL,
    Description                   VARCHAR(100) NOT NULL,
    SalesOrganization             VARCHAR(10) NOT NULL DEFAULT 'KIPL',
    Active                        CHAR(1) NOT NULL DEFAULT 'Y',
    CreatedAt                     DATETIME NOT NULL DEFAULT GETDATE(),
    UpdatedAt                     DATETIME NOT NULL DEFAULT GETDATE()
  );

  INSERT INTO SAP_Distribution_Channel_SDKDS
    (DistributionChannelCode, Description, SalesOrganization)
  VALUES
    ('DS', 'Domestic Sales',              'KIPL'),
    ('ES', 'Export Sales',                'KIPL'),
    ('SS', 'Service Sale',               'KIPL'),
    ('ST', 'Stock Transfer Order/Subcon', 'KIPL'),
    ('FC', 'Domestic FOC',               'KIPL'),
    ('EF', 'Export FOC',                 'KIPL'),
    ('TP', 'Third-Party Sales',          'KIPL'),
    ('JW', 'Job Work Sales',             'KIPL'),
    ('AS', 'Asset Sales',                'KIPL'),
    ('SR', 'Scrap Sales',                'KIPL');

  PRINT 'Created and seeded SAP_Distribution_Channel_SDKDS (10 rows)';
END
ELSE
BEGIN
  PRINT 'SAP_Distribution_Channel_SDKDS already exists — skipping';
END;
