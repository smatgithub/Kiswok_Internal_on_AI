import * as sql from 'mssql';
import { toIsoUom, WEIGHT_UOM_ISO } from '@kiswok/shared';

/**
 * Shared joins for SAP source items.
 *
 * Product Group (MATKL) = sap_material_group.sap_mat_grp_code
 * joined on sap_material_group.grntypeid = RAWMATERIAL.GrnTypeId
 * (exact Id — not grntype text, which can duplicate / mismatch).
 *
 * Product Type (MTART) resolution order:
 *  1) sap_live_item_master.mat_type for this RawMatID
 *  2) majority mat_type of live peers with same sap_mat_grp_code
 *  3) invent_grntype hierarchy (Service / Spares / FG / Capital / …)
 *  4) IcSoft code prefix (e.g. SER% → ZSRV)
 *  5) ZRAW
 *
 * OUTER APPLY TOP 1 keeps one material-group / plant / item-master row
 * so other fields are not multiplied or dropped by LEFT JOIN fan-out.
 */
const SAP_SOURCE_JOINS_SQL = `
LEFT JOIN INVENT_GRNTYPE igt
  ON igt.GRNTYPEID = r.GRNTYPEID
OUTER APPLY (
  SELECT TOP (1)
    smg0.sap_mat_grp_code,
    smg0.sap_mat_grp_text,
    smg0.grntype
  FROM sap_material_group smg0
  WHERE smg0.grntypeid = r.GrnTypeId
  ORDER BY smg0.sap_mat_grp_code
) smg
OUTER APPLY (
  SELECT TOP (1)
    slim0.sapcode,
    slim0.mat_type,
    slim0.mat_group,
    slim0.sapdescription,
    slim0.uom
  FROM sap_live_item_master slim0
  WHERE slim0.rawmatid = r.rawmatid
  ORDER BY slim0.id DESC
) slim
OUTER APPLY (
  -- Peer Product Type by SAP material group
  SELECT TOP (1) peer.mat_type
  FROM sap_live_item_master peer
  WHERE peer.mat_group = COALESCE(
          NULLIF(LTRIM(RTRIM(slim.mat_group)), ''),
          NULLIF(LTRIM(RTRIM(smg.sap_mat_grp_code)), '')
        )
    AND NULLIF(LTRIM(RTRIM(peer.mat_type)), '') IS NOT NULL
  GROUP BY peer.mat_type
  ORDER BY COUNT(*) DESC, peer.mat_type
) peer_mt
OUTER APPLY (
  -- Best-effort Product Group for Service GRN types from live ZSRV rows
  SELECT TOP (1) peer.mat_group
  FROM sap_live_item_master peer
  WHERE peer.mat_type = 'ZSRV'
    AND NULLIF(LTRIM(RTRIM(peer.mat_group)), '') IS NOT NULL
    AND peer.sapdescription LIKE '%' + ISNULL(igt.GrnType, '___nomatch___') + '%'
  ORDER BY peer.id DESC
) peer_srv_grp
OUTER APPLY (
  SELECT TOP (1) peer.mat_group AS mat_group
  FROM sap_live_item_master peer
  WHERE peer.mat_type = 'ZSRV'
    AND peer.mat_group LIKE 'SRV%'
  GROUP BY peer.mat_group
  ORDER BY COUNT(*) DESC, peer.mat_group
) peer_srv_grp_fallback
OUTER APPLY (
  SELECT TOP (1)
    sim0.item_name,
    sim0.rawmatid
  FROM sap_item_master sim0
  WHERE sim0.rawmatid = r.rawmatid
  ORDER BY sim0.rawmatid
) sim
LEFT JOIN sap_new_item_master snim
  ON snim.rawmatid = r.rawmatid
LEFT JOIN gst_hsn_sac_no g
  ON g.hsn_sac_id = r.hsn_sac_id
LEFT JOIN sap_uom_master u
  ON u.uom = r.uom
LEFT JOIN sap_uom_master up
  ON up.uom = r.PurchaseUom
OUTER APPLY (
  SELECT TOP (1)
    ig.LocationID,
    CASE
      WHEN ig.LocationID = 14 THEN '2001'
      ELSE spl.sap_plantcode
    END AS sap_plantcode,
    CASE
      WHEN ig.LocationID = 14 THEN 'WUNM'
      WHEN spl.sap_plantcode = '3001' THEN 'MXST'
      ELSE sl.location_code
    END AS storage_location
  FROM Invent_GrnMaterialdetail igm
  INNER JOIN INVENT_GRN ig
    ON ig.GrnNo = igm.Grnno
  LEFT JOIN sap_plant_location_mapping spl
    ON spl.companyid = ig.LocationID
  OUTER APPLY (
    SELECT TOP (1) sl0.location_code
    FROM sap_storage_location sl0
    WHERE sl0.plant_code = CASE
            WHEN ig.LocationID = 14 THEN '2001'
            ELSE spl.sap_plantcode
          END
      AND sl0.location_code IN (
            'MXST','SH01','SH02','SH03','VNRT','RGOL','RGNW','NMST','SUBC','WUNM','RWDP',
            'FCDP','GRDP','CNCD','DN2D','CSPN','CSHT','MLTG','DISA','HFMM','JOLT','SNTM',
            'SNDP','DSND','SSND','SBDP','LBDP','WUN6'
          )
    ORDER BY sl0.location_code
  ) sl
  WHERE igm.Rawmatid = r.RawMatID
  ORDER BY igm.Grndate DESC
) plant
`;

/**
 * IcSoft GRNTYPEID / hierarchy / code prefix → SAP material type (MTART).
 * Used when sap_live_item_master.mat_type is not already known for the item
 * or its material-group peers.
 *
 * Aliases required: r (RAWMATERIAL), igt (INVENT_GRNTYPE).
 */
export const SAP_GRN_TO_MTART_CASE_SQL = `
CASE
  WHEN igt.GRNTYPEID = -100
    OR igt.OlevelID = -100
    OR igt.GRNParentLevel = -100
    OR LEFT(r.RAWMATCODE, 3) = 'SER'
  THEN 'ZSRV'
  WHEN igt.GRNTYPEID = 19 OR igt.GRNParentLevel = 19 THEN 'ZSPT'
  WHEN igt.GRNTYPEID = 4 OR igt.GRNParentLevel = 4 OR igt.OlevelID = 4 THEN 'ZFGM'
  WHEN igt.GRNTYPEID IN (6, 324)
    OR igt.GRNParentLevel IN (6, 324)
    OR igt.OlevelID IN (6, 324)
  THEN 'ZCAP'
  WHEN igt.GRNTYPEID = 1 OR igt.GRNParentLevel = 1 OR igt.OlevelID = 1 THEN 'ZINP'
  WHEN igt.GRNTYPEID = 3 OR igt.GRNParentLevel = 3 OR igt.OlevelID = 3 THEN 'ZRAW'
  WHEN igt.GRNTYPEID IN (2, -10)
    OR igt.GRNParentLevel IN (2, -10)
    OR igt.OlevelID IN (2, -10)
  THEN 'ZCON'
  ELSE 'ZRAW'
END
`;

const SAP_SOURCE_SELECT_LIST_SQL = `
  r.RAWMATCODE AS IcsoftCode,
  CASE
    WHEN NULLIF(LTRIM(RTRIM(slim.sapcode)), '') IS NOT NULL
      THEN CASE
        WHEN TRY_CAST(slim.sapcode AS BIGINT) IS NOT NULL
          THEN CONVERT(VARCHAR(20), TRY_CAST(slim.sapcode AS BIGINT))
        ELSE LTRIM(RTRIM(slim.sapcode))
      END
    ELSE snim.sap_item_code
  END AS sap_item_code,
  COALESCE(smg.sap_mat_grp_text, igt.GrnType) AS sap_mat_grp_text,
  COALESCE(igt.GrnType, smg.grntype) AS grntype,
  COALESCE(
    NULLIF(LTRIM(RTRIM(slim.mat_group)), ''),
    smg.sap_mat_grp_code,
    CASE
      WHEN igt.GRNTYPEID = -100
        OR igt.OlevelID = -100
        OR igt.GRNParentLevel = -100
        OR LEFT(r.RAWMATCODE, 3) = 'SER'
      THEN COALESCE(peer_srv_grp.mat_group, peer_srv_grp_fallback.mat_group)
      ELSE NULL
    END
  ) AS [Product Group],
  COALESCE(
    NULLIF(LTRIM(RTRIM(slim.mat_type)), ''),
    NULLIF(LTRIM(RTRIM(peer_mt.mat_type)), ''),
    ${SAP_GRN_TO_MTART_CASE_SQL}
  ) AS productType,
  LEFT(
    UPPER(COALESCE(
      NULLIF(LTRIM(RTRIM(slim.sapdescription)), ''),
      NULLIF(LTRIM(RTRIM(sim.item_name)), ''),
      r.RawMatName
    )),
    40
  ) AS Rawmatname,
  'EN' AS lang,
  COALESCE(
    NULLIF(LTRIM(RTRIM(slim.uom)), ''),
    u.sap_uom,
    r.UOM
  ) AS baseuom,
  COALESCE(up.sap_uom, r.PurchaseUom) AS PurchaseUom,
  CASE
    WHEN LEN(r.RAWMATNAME) > 40 THEN UPPER(r.RAWMATNAME)
    ELSE ''
  END AS [LONG TEXT],
  'KGM' AS WeightUom,
  r.weight,
  g.hsncode,
  plant.LocationID,
  ISNULL(plant.sap_plantcode, '2001') AS sap_plantcode,
  plant.storage_location,
  r.GrnTypeId AS GrnTypeId,
  r.RawMatID,
  CONCAT(ISNULL(plant.sap_plantcode, '2001'), '01') AS profitcentercode
`;

/** Eligible ZRAW candidates not yet present in sap_new_item_master */
export const SAP_CANDIDATE_ITEMS_SQL = `
SELECT
${SAP_SOURCE_SELECT_LIST_SQL}
FROM RAWMATERIAL r
${SAP_SOURCE_JOINS_SQL}
WHERE r.Active = 'Y'
  AND snim.rawmatid IS NULL
ORDER BY r.GrnTypeId, r.RawMatID
`;

/**
 * Search with filters applied on base columns first so plant OUTER APPLY
 * only runs for the matched TOP rows (not the full candidate set).
 */
export const SAP_CANDIDATE_SEARCH_SQL = `
SELECT TOP (@limit)
${SAP_SOURCE_SELECT_LIST_SQL}
FROM RAWMATERIAL r
${SAP_SOURCE_JOINS_SQL}
WHERE r.Active = 'Y'
  AND snim.rawmatid IS NULL
  AND (
    @q = '' OR
    r.RAWMATCODE LIKE '%' + @q + '%' OR
    ISNULL(r.RawMatName, '') LIKE '%' + @q + '%' OR
    ISNULL(sim.item_name, '') LIKE '%' + @q + '%' OR
    ISNULL(slim.sapdescription, '') LIKE '%' + @q + '%' OR
    ISNULL(smg.sap_mat_grp_code, '') LIKE '%' + @q + '%' OR
    ISNULL(slim.mat_group, '') LIKE '%' + @q + '%' OR
    ISNULL(igt.GrnType, '') LIKE '%' + @q + '%' OR
    ISNULL(slim.mat_type, '') LIKE '%' + @q + '%' OR
    CAST(r.RawMatID AS VARCHAR(20)) LIKE '%' + @q + '%'
  )
ORDER BY r.GrnTypeId, r.RawMatID
`;

/**
 * Load one IcSoft material for "Extend for SAP" even if it is not in the
 * candidate list (joins / sap_new_item_master filters may exclude it).
 */
export const SAP_EXTEND_BY_ID_SQL = `
SELECT
${SAP_SOURCE_SELECT_LIST_SQL}
FROM RAWMATERIAL r
${SAP_SOURCE_JOINS_SQL}
WHERE r.RawMatID = @rawMatId
  AND r.Active = 'Y'
`;

export function mapSourceRow(row: Record<string, unknown>) {
  const productGroupRaw = (row['Product Group'] ?? row.ProductGroup ?? null) as
    | string
    | null;
  // SAP MATKL max length 9 — sap_mat_grp_code is already varchar(9); trim as safety.
  const productGroup =
    productGroupRaw != null ? String(productGroupRaw).trim().slice(0, 9) : null;

  const productTypeRaw = (row.productType ?? row.ProductType ?? null) as
    | string
    | null;
  const productType =
    productTypeRaw != null && String(productTypeRaw).trim()
      ? String(productTypeRaw).trim().toUpperCase().slice(0, 4)
      : 'ZRAW';

  return {
    IcsoftCode: String(row.IcsoftCode ?? ''),
    sap_item_code: row.sap_item_code != null ? String(row.sap_item_code) : null,
    sap_mat_grp_text:
      row.sap_mat_grp_text != null ? String(row.sap_mat_grp_text) : null,
    grntype: row.grntype != null ? String(row.grntype) : null,
    ProductGroup: productGroup,
    productType,
    Rawmatname: row.Rawmatname != null ? String(row.Rawmatname) : null,
    lang: String(row.lang ?? 'EN'),
    baseuom: toIsoUom(row.baseuom != null ? String(row.baseuom) : null) || null,
    PurchaseUom:
      toIsoUom(row.PurchaseUom != null ? String(row.PurchaseUom) : null) || null,
    LONG_TEXT: (row['LONG TEXT'] ?? row.LONG_TEXT ?? null) as string | null,
    WeightUom: WEIGHT_UOM_ISO,
    weight: row.weight != null ? Number(row.weight) : null,
    hsncode: row.hsncode != null ? String(row.hsncode) : null,
    LocationID: row.LocationID != null ? Number(row.LocationID) : null,
    sap_plantcode: row.sap_plantcode != null ? String(row.sap_plantcode) : null,
    storage_location:
      row.storage_location != null ? String(row.storage_location) : null,
    GrnTypeId: row.GrnTypeId != null ? Number(row.GrnTypeId) : null,
    RawMatID: Number(row.RawMatID),
    profitcentercode:
      row.profitcentercode != null ? String(row.profitcentercode) : null,
  };
}

export { sql };
