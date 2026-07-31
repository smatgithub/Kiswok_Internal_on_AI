import * as sql from 'mssql';

/** Eligible ZRAW candidates not yet present in sap_new_item_master */
export const SAP_CANDIDATE_ITEMS_SQL = `
SELECT DISTINCT
  r.RAWMATCODE AS IcsoftCode,
  snim.sap_item_code,
  smg.sap_mat_grp_text,
  igt.grntype,
  smg.sap_mat_grp_code AS [Product Group],
  LEFT(UPPER(sim.item_name), 40) AS Rawmatname,
  'EN' AS lang,
  u.sap_uom AS baseuom,
  up.sap_uom AS PurchaseUom,
  CASE WHEN LEN(RAWMATNAME) > 40 THEN UPPER(RAWMATNAME) ELSE '' END AS [LONG TEXT],
  CASE WHEN r.Weight > 0 THEN r.WeightUom ELSE '' END AS WeightUom,
  r.weight,
  g.hsncode,
  ig.LocationID,
  CASE WHEN ig.LocationID = 14 THEN '2001' ELSE spl.sap_plantcode END AS sap_plantcode,
  CASE
    WHEN ig.LocationID = 14 THEN 'WUNM'
    WHEN spl.sap_plantcode = '3001' THEN 'MXST'
    ELSE location_code
  END AS storage_location,
  IGT.GrnTypeId,
  r.RawMatID,
  CONCAT(CASE WHEN ig.LocationID = 14 THEN '2001' ELSE spl.sap_plantcode END, '01') AS profitcentercode
FROM RAWMATERIAL R
INNER JOIN INVENT_GRNTYPE IGT ON IGT.GRNTYPEID = R.GRNTYPEID
LEFT JOIN gst_hsn_sac_no g ON g.hsn_sac_id = r.hsn_sac_id
INNER JOIN M_grntype mg ON mg.rawmatid = r.rawmatid
INNER JOIN sap_material_group smg ON smg.grntype = igt.GrnType
INNER JOIN sap_item_master sim ON sim.rawmatid = mg.rawmatid
LEFT OUTER JOIN sap_new_item_master snim ON snim.rawmatid = sim.rawmatid
LEFT JOIN Invent_GrnMaterialdetail igm ON igm.Rawmatid = r.RawMatID
LEFT JOIN INVENT_GRN IG ON IG.GrnNo = IGM.Grnno
LEFT JOIN sap_uom_master u ON u.uom = r.uom
LEFT JOIN sap_uom_master up ON up.uom = r.PurchaseUom
LEFT JOIN sap_plant_location_mapping spl ON spl.companyid = ig.LocationID
LEFT JOIN (
  SELECT plant_code, location_code
  FROM sap_storage_location
  WHERE location_code IN (
    'MXST','SH01','SH02','SH03','VNRT','RGOL','RGNW','NMST','SUBC','WUNM','RWDP',
    'FCDP','GRDP','CNCD','DN2D','CSPN','CSHT','MLTG','DISA','HFMM','JOLT','SNTM',
    'SNDP','DSND','SSND','SBDP','LBDP','VNRT','WUN6'
  )
) l ON l.plant_code = spl.sap_plantcode
  AND igm.Grndate >= '2025-04-01'
WHERE snim.rawmatid IS NULL
ORDER BY IGT.GrnTypeId, r.RawMatID
`;

export const SAP_CANDIDATE_SEARCH_SQL = `
SELECT TOP (@limit) *
FROM (
${SAP_CANDIDATE_ITEMS_SQL.replace('ORDER BY IGT.GrnTypeId, r.RawMatID', '')}
) src
WHERE
  (@q = '' OR
   IcsoftCode LIKE '%' + @q + '%' OR
   ISNULL(Rawmatname, '') LIKE '%' + @q + '%' OR
   ISNULL([Product Group], '') LIKE '%' + @q + '%' OR
   CAST(RawMatID AS VARCHAR(20)) LIKE '%' + @q + '%')
ORDER BY GrnTypeId, RawMatID
`;

/**
 * Load one IcSoft material for "Extend for SAP" even if it is not in the
 * candidate list (joins / sap_new_item_master filters may exclude it).
 */
export const SAP_EXTEND_BY_ID_SQL = `
SELECT TOP 1
  r.RAWMATCODE AS IcsoftCode,
  snim.sap_item_code,
  smg.sap_mat_grp_text,
  igt.grntype,
  COALESCE(smg.sap_mat_grp_code, igt.grntype) AS [Product Group],
  LEFT(UPPER(COALESCE(sim.item_name, r.RawMatName)), 40) AS Rawmatname,
  'EN' AS lang,
  COALESCE(u.sap_uom, r.UOM) AS baseuom,
  COALESCE(up.sap_uom, r.PurchaseUom) AS PurchaseUom,
  CASE WHEN LEN(r.RAWMATNAME) > 40 THEN UPPER(r.RAWMATNAME) ELSE '' END AS [LONG TEXT],
  CASE WHEN r.Weight > 0 THEN r.WeightUom ELSE '' END AS WeightUom,
  r.weight,
  g.hsncode,
  ig.LocationID,
  CASE WHEN ig.LocationID = 14 THEN '2001' ELSE spl.sap_plantcode END AS sap_plantcode,
  CASE
    WHEN ig.LocationID = 14 THEN 'WUNM'
    WHEN spl.sap_plantcode = '3001' THEN 'MXST'
    ELSE l.location_code
  END AS storage_location,
  IGT.GrnTypeId,
  r.RawMatID,
  CONCAT(
    CASE WHEN ig.LocationID = 14 THEN '2001' ELSE ISNULL(spl.sap_plantcode, '2001') END,
    '01'
  ) AS profitcentercode
FROM RAWMATERIAL R
INNER JOIN INVENT_GRNTYPE IGT ON IGT.GRNTYPEID = R.GRNTYPEID
LEFT JOIN gst_hsn_sac_no g ON g.hsn_sac_id = r.hsn_sac_id
LEFT JOIN M_grntype mg ON mg.rawmatid = r.rawmatid
LEFT JOIN sap_material_group smg ON smg.grntype = igt.GrnType
LEFT JOIN sap_item_master sim ON sim.rawmatid = r.rawmatid
LEFT OUTER JOIN sap_new_item_master snim ON snim.rawmatid = r.rawmatid
LEFT JOIN Invent_GrnMaterialdetail igm ON igm.Rawmatid = r.RawMatID
LEFT JOIN INVENT_GRN IG ON IG.GrnNo = IGM.Grnno
LEFT JOIN sap_uom_master u ON u.uom = r.uom
LEFT JOIN sap_uom_master up ON up.uom = r.PurchaseUom
LEFT JOIN sap_plant_location_mapping spl ON spl.companyid = ig.LocationID
LEFT JOIN (
  SELECT plant_code, location_code
  FROM sap_storage_location
  WHERE location_code IN (
    'MXST','SH01','SH02','SH03','VNRT','RGOL','RGNW','NMST','SUBC','WUNM','RWDP',
    'FCDP','GRDP','CNCD','DN2D','CSPN','CSHT','MLTG','DISA','HFMM','JOLT','SNTM',
    'SNDP','DSND','SSND','SBDP','LBDP','VNRT','WUN6'
  )
) l ON l.plant_code = spl.sap_plantcode
WHERE r.RawMatID = @rawMatId
  AND r.Active = 'Y'
ORDER BY igm.Grndate DESC
`;

export function mapSourceRow(row: Record<string, unknown>) {
  return {
    IcsoftCode: String(row.IcsoftCode ?? ''),
    sap_item_code: row.sap_item_code != null ? String(row.sap_item_code) : null,
    sap_mat_grp_text: row.sap_mat_grp_text != null ? String(row.sap_mat_grp_text) : null,
    grntype: row.grntype != null ? String(row.grntype) : null,
    ProductGroup: (row['Product Group'] ?? row.ProductGroup ?? null) as string | null,
    Rawmatname: row.Rawmatname != null ? String(row.Rawmatname) : null,
    lang: String(row.lang ?? 'EN'),
    baseuom: row.baseuom != null ? String(row.baseuom) : null,
    PurchaseUom: row.PurchaseUom != null ? String(row.PurchaseUom) : null,
    LONG_TEXT: (row['LONG TEXT'] ?? row.LONG_TEXT ?? null) as string | null,
    WeightUom: row.WeightUom != null ? String(row.WeightUom) : null,
    weight: row.weight != null ? Number(row.weight) : null,
    hsncode: row.hsncode != null ? String(row.hsncode) : null,
    LocationID: row.LocationID != null ? Number(row.LocationID) : null,
    sap_plantcode: row.sap_plantcode != null ? String(row.sap_plantcode) : null,
    storage_location: row.storage_location != null ? String(row.storage_location) : null,
    GrnTypeId: row.GrnTypeId != null ? Number(row.GrnTypeId) : null,
    RawMatID: Number(row.RawMatID),
    profitcentercode: row.profitcentercode != null ? String(row.profitcentercode) : null,
  };
}

export { sql };
