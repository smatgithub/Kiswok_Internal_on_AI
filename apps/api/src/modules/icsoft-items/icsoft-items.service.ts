import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';
import { DatabaseService } from '../../database/database.service';
import { PipelineStoreService } from '../sap-item/pipeline-store.service';

export type ItemCategory = {
  grnTypeId: number | null;
  grnType: string;
  subGrnTypeIds: number[];
  subGrnTypeIdsRaw: string | null;
};

export type ItemOption = {
  rawMatId: number;
  label: string;
  rawMatCode: string;
  rawMatName: string;
  grnTypeId: number | null;
};

export type ItemShopLink = {
  shopId: number | null;
  shopName: string | null;
  itemSubCategory: string | null;
};

export type ItemStoreLocation = {
  key: string;
  locationId: number;
  locationName: string | null;
  sapPlantCode: string | null;
  storageLocation: string | null;
  locationMaxLevel: number | null;
  locationMinLevel: number | null;
  locationLeadTime: number | null;
  locationBatchSize: number | null;
  locationReorderLevel: number | null;
  locationMinMaxReqd: string | null;
};

export type ItemDetailPayload = {
  item: Record<string, unknown>;
  shops: ItemShopLink[];
  locations: ItemStoreLocation[];
};

const MOCK_CATEGORIES: ItemCategory[] = [
  {
    grnTypeId: 10,
    grnType: 'Adapter',
    subGrnTypeIds: [101, 102],
    subGrnTypeIdsRaw: '101,102',
  },
  {
    grnTypeId: 11,
    grnType: 'Adapter Hydraulic (RM)',
    subGrnTypeIds: [111],
    subGrnTypeIdsRaw: '111',
  },
  {
    grnTypeId: 12,
    grnType: 'Adapter Side Lock (RM)',
    subGrnTypeIds: [121, 122],
    subGrnTypeIdsRaw: '121,122',
  },
  {
    grnTypeId: 20,
    grnType: 'Consumable',
    subGrnTypeIds: [201, 202],
    subGrnTypeIdsRaw: '201,202',
  },
  {
    grnTypeId: 30,
    grnType: 'Rawmaterial',
    subGrnTypeIds: [301],
    subGrnTypeIdsRaw: '301',
  },
];

const MOCK_ITEMS: ItemOption[] = [
  {
    rawMatId: 373252,
    label: 'IRON0003 | STEEL SCRAP-C.I. (HIGH SULPHUR)',
    rawMatCode: 'IRON0003',
    rawMatName: 'STEEL SCRAP-C.I. (HIGH SULPHUR)',
    grnTypeId: 301,
  },
  {
    rawMatId: 10001,
    label: 'CONGEDB0032 | DRILL BIT 10MM X 116 FLUTE LENGTH (T/S)',
    rawMatCode: 'CONGEDB0032',
    rawMatName: 'DRILL BIT 10MM X 116 FLUTE LENGTH (T/S)',
    grnTypeId: 201,
  },
  {
    rawMatId: 10002,
    label: 'ADPH001 | HYDRAULIC ADAPTER 1/2"',
    rawMatCode: 'ADPH001',
    rawMatName: 'HYDRAULIC ADAPTER 1/2"',
    grnTypeId: 111,
  },
  {
    rawMatId: 10003,
    label: 'ADPS001 | SIDE LOCK ADAPTER',
    rawMatCode: 'ADPS001',
    rawMatName: 'SIDE LOCK ADAPTER',
    grnTypeId: 121,
  },
];

function parseIdList(raw: unknown): number[] {
  if (raw == null) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function uniqueIds(ids: number[]): number[] {
  return [...new Set(ids)];
}

@Injectable()
export class IcsoftItemsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly pipeline: PipelineStoreService,
  ) {}

  private dbName(): string {
    return this.config.get<string>('DB_NAME') || 'icsoft';
  }

  private useMock(): boolean {
    return (
      this.config.get('USE_MOCK_ERP') === 'true' || !this.db.isConfigured()
    );
  }

  async getCategories(): Promise<ItemCategory[]> {
    if (this.useMock()) return MOCK_CATEGORIES;

    try {
      const rows = await this.db.run(this.dbName(), async (request) =>
        request.query(`
          SELECT
            GrnTypeId,
            GrnType AS grntype,
            SubgrntypeIds
          FROM invent_grntype
          WHERE active = 'Y'
          ORDER BY GrnType
        `),
      );

      return rows.map((row) => {
        const r = row as Record<string, unknown>;
        const sub = parseIdList(r.SubgrntypeIds ?? r.subgrntypeids);
        const ownId =
          r.GrnTypeId != null && Number.isFinite(Number(r.GrnTypeId))
            ? Number(r.GrnTypeId)
            : null;
        return {
          grnTypeId: ownId,
          grnType: String(r.grntype ?? r.GrnType ?? ''),
          subGrnTypeIds: sub,
          subGrnTypeIdsRaw:
            r.SubgrntypeIds != null ? String(r.SubgrntypeIds) : null,
        };
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Category query failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Resolve GrnTypeId IN-list from selected category keys.
   * Category keys are grnType strings; "ALL" means every active category.
   */
  private resolveTypeIds(
    categories: ItemCategory[],
    selectedGrnTypes: string[],
  ): number[] {
    const allSelected =
      selectedGrnTypes.length === 0 ||
      selectedGrnTypes.includes('ALL') ||
      selectedGrnTypes.includes('__ALL__');

    const picked = allSelected
      ? categories
      : categories.filter((c) => selectedGrnTypes.includes(c.grnType));

    const ids: number[] = [];
    for (const c of picked) {
      ids.push(...c.subGrnTypeIds);
      if (c.grnTypeId != null) ids.push(c.grnTypeId);
    }
    return uniqueIds(ids);
  }

  async getItemOptions(selectedGrnTypes: string[], q = ''): Promise<ItemOption[]> {
    const categories = await this.getCategories();
    const typeIds = this.resolveTypeIds(categories, selectedGrnTypes);
    const query = q.trim().toLowerCase();

    if (this.useMock()) {
      return MOCK_ITEMS.filter((item) => {
        const typeOk =
          selectedGrnTypes.includes('ALL') ||
          selectedGrnTypes.length === 0 ||
          typeIds.length === 0 ||
          (item.grnTypeId != null && typeIds.includes(item.grnTypeId));
        const textOk =
          !query ||
          item.label.toLowerCase().includes(query) ||
          item.rawMatCode.toLowerCase().includes(query);
        return typeOk && textOk;
      }).slice(0, 200);
    }

    if (!typeIds.length) {
      return [];
    }

    try {
      const rows = await this.db.run(this.dbName(), async (request) => {
        // Dynamic IN list via TVP-style values table
        const idList = typeIds.map((_, i) => `@t${i}`).join(',');
        typeIds.forEach((id, i) => request.input(`t${i}`, sql.Int, id));
        request.input('q', sql.NVarChar(200), q.trim());
        return request.query(`
          SELECT TOP 200
            RawMatID,
            RawMatCode,
            RawMatName,
            GrnTypeId,
            RawMatCode + ' | ' + RawMatName AS Label
          FROM rawmaterial
          WHERE Active = 'Y'
            AND GrnTypeId IN (${idList})
            AND (
              @q = ''
              OR RawMatCode LIKE '%' + @q + '%'
              OR RawMatName LIKE '%' + @q + '%'
            )
          ORDER BY RawMatCode
        `);
      });

      return rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          rawMatId: Number(r.RawMatID),
          label: String(r.Label ?? `${r.RawMatCode} | ${r.RawMatName}`),
          rawMatCode: String(r.RawMatCode ?? ''),
          rawMatName: String(r.RawMatName ?? ''),
          grnTypeId: r.GrnTypeId != null ? Number(r.GrnTypeId) : null,
        };
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Item list query failed: ${(err as Error).message}`,
      );
    }
  }

  async getItemGrid(input: {
    selectedGrnTypes: string[];
    selectedRawMatIds: number[];
    allItems: boolean;
  }): Promise<Record<string, unknown>[]> {
    const categories = await this.getCategories();
    const typeIds = this.resolveTypeIds(categories, input.selectedGrnTypes);
    const itemIds = uniqueIds(input.selectedRawMatIds.filter((n) => Number.isFinite(n)));

    if (!input.allItems && itemIds.length === 0 && typeIds.length === 0) {
      throw new BadRequestException(
        'Select at least one Item Category or Item (or All).',
      );
    }

    if (this.useMock()) {
      const filtered = MOCK_ITEMS.filter((item) => {
        if (!input.allItems && itemIds.length > 0) {
          return itemIds.includes(item.rawMatId);
        }
        if (typeIds.length > 0 && item.grnTypeId != null) {
          return typeIds.includes(item.grnTypeId);
        }
        return true;
      });

      return this.enrichSapStatus(
        filtered.map((item, idx) => ({
          'Sl No': idx + 1,
          RawMatCode: item.rawMatCode,
          RawMatName: item.rawMatName,
          'SAP Extended': item.rawMatId % 3 === 0 ? 'Extended' : 'Not yet',
          'SAP Item Code': item.rawMatId % 3 === 0 ? `MOCK-${item.rawMatId}` : null,
          'SAP Pipeline': '—',
          'Inspection Reqired':
            item.rawMatId % 2 === 0
              ? 'Inspection Required'
              : 'Inspection Not Reqired',
          Description: item.rawMatName,
          'Main Category': 'Rawmaterial',
          'Item Category':
            categories.find((c) => c.subGrnTypeIds.includes(item.grnTypeId || -1))
              ?.grnType || '—',
          Prefix: item.rawMatCode.slice(0, 4),
          UOM: item.grnTypeId === 201 ? 'EA' : 'KGM',
          PurchaseUom: item.grnTypeId === 201 ? 'EA' : 'KGM',
          Manufactured: 0,
          Weight: item.grnTypeId === 201 ? 0 : 1,
          WeightUom: 'KGM',
          LeadTime: 7,
          Tolerance: 0,
          InspecReq: item.rawMatId % 2,
          InspCriteria: '',
          SpecificationNo: '',
          DrawingNo: '',
          HSNCode: '72044900',
          Name: 'Stores Consumable',
          Saleable: 0,
          Max_level: 100,
          Min_level: 10,
          EntryComputer: 'MOCK-PC',
          EntryBy: 'E001 | Demo User',
          ShopName: 'Machine Shop',
          LocationMaxLevel: 100,
          LocationMinLevel: 10,
          LocationLeadTime: 3,
          LocationBatchSize: 1,
          LocationCount: 2,
          ShopCount: 2,
          Attachment: null,
          RawMatID: item.rawMatId,
        })),
      );
    }

    try {
      const rows = await this.db.run(this.dbName(), async (request) => {
        let whereExtra = '';

        if (!input.allItems && itemIds.length > 0) {
          const list = itemIds.map((_, i) => `@r${i}`).join(',');
          itemIds.forEach((id, i) => request.input(`r${i}`, sql.Int, id));
          whereExtra += ` AND R.RawMatID IN (${list}) `;
        } else if (typeIds.length > 0) {
          const list = typeIds.map((_, i) => `@g${i}`).join(',');
          typeIds.forEach((id, i) => request.input(`g${i}`, sql.Int, id));
          whereExtra += ` AND IGT.GrnTypeID IN (${list}) `;
        }

        return request.query(`
          SELECT
            ROW_NUMBER() OVER (ORDER BY R.RawMatCode) AS [Sl No],
            R.RawMatID,
            R.RawMatCode,
            R.RawMatName,
            CASE
              WHEN snim.rawmatid IS NOT NULL THEN 'Extended'
              ELSE 'Not yet'
            END AS [SAP Extended],
            snim.sap_item_code AS [SAP Item Code],
            CASE
              WHEN InspecReq = 0 THEN 'Inspection Not Reqired'
              ELSE 'Inspection Required'
            END AS [Inspection Reqired],
            R.Description,
            ISNULL(mainCat.GrnType, parentCat.GrnType) AS [Main Category],
            IGT.GrnType AS [Item Category],
            IGT.Prefix,
            R.UOM,
            R.PurchaseUom,
            R.Iscreateproduct AS [Manufactured],
            R.Weight,
            R.WeightUom,
            R.LeadTime,
            R.PercofExcp AS Tolerance,
            R.InspecReq,
            R.InspCriteria,
            R.SpecificationNo,
            R.DrawingNo,
            hsn.HSNCode,
            s.Name,
            R.Saleable,
            R.Max_level,
            R.Min_level,
            R.EntryComputer,
            empcode + ' | ' + empname AS EntryBy,
            shop.ShopName,
            loc.LocationMaxLevel,
            loc.LocationMinLevel,
            loc.LocationLeadTime,
            loc.LocationBatchSize,
            (
              SELECT COUNT(1)
              FROM Item_Location_Link illc
              WHERE illc.RawMatId = R.RawMatID
            ) AS LocationCount,
            (
              SELECT COUNT(1)
              FROM Invent_Rawmaterial irc
              WHERE irc.Af_ID = R.RawMatID
            ) AS ShopCount,
            DrawAttach AS Attachment
          FROM dbo.RawMaterial R
          INNER JOIN Invent_GrnType IGT ON R.GrnTypeId = IGT.GrnTypeId
          LEFT JOIN sap_new_item_master snim ON snim.rawmatid = R.RawMatID
          OUTER APPLY (
            SELECT TOP 1 igtm.GrnType
            FROM Invent_GrnType igtm
            WHERE CHARINDEX(
                    CONCAT(',', IGT.GrnTypeId, ','),
                    CONCAT(',', igtm.SubgrntypeIds, ',')
                  ) > 0
              AND igtm.GrnParentlevel = 4
          ) mainCat
          OUTER APPLY (
            SELECT TOP 1 igtm1.GrnType
            FROM Invent_GrnType igtm1
            WHERE CHARINDEX(
                    CONCAT(',', IGT.GrnTypeId, ','),
                    CONCAT(',', igtm1.SubgrntypeIds, ',')
                  ) > 0
              AND igtm1.GrnParentlevel = 0
          ) parentCat
          LEFT JOIN Employee e ON e.EmpId = R.EntryEmpId
          LEFT JOIN GST_HSN_SAC_NO hsn ON hsn.Hsn_Sac_ID = R.HSN_SAC_ID
          LEFT JOIN [icsoftledger].dbo.accounts s ON R.AccExpId = s.ID
          OUTER APPLY (
            SELECT TOP 1 mis.ShopName
            FROM Invent_Rawmaterial ir
            LEFT JOIN M_Item_shop mis ON mis.ShopId = ir.Shop
            WHERE ir.Af_ID = R.RawMatID
            ORDER BY ir.Af_ID
          ) shop
          OUTER APPLY (
            SELECT TOP 1
              ill.LocationMaxLevel,
              ill.LocationMinLevel,
              ill.LocationLeadTime,
              ill.LocationBatchSize
            FROM Item_Location_Link ill
            WHERE ill.RawMatId = R.RawMatID
            ORDER BY ill.RawMatId
          ) loc
          WHERE R.active = 'Y'
            ${whereExtra}
          ORDER BY R.RawMatCode
        `);
      });
      return this.enrichSapStatus(rows as Record<string, unknown>[]);
    } catch (err) {
      throw new ServiceUnavailableException(
        `Item grid query failed: ${(err as Error).message}`,
      );
    }
  }

  /** Overlay pipeline stage onto grid rows (pending / committed / exported). */
  private enrichSapStatus(
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    const byRawMat = new Map(
      this.pipeline.list().map((e) => [e.rawMatId, e] as const),
    );
    const stageLabel: Record<string, string> = {
      pending: 'Pending',
      committed: 'Ready for template',
      exported: 'Template created',
    };

    return rows.map((row) => {
      const rawMatId = Number(row.RawMatID);
      const entry = Number.isFinite(rawMatId) ? byRawMat.get(rawMatId) : undefined;
      const extended =
        String(row['SAP Extended'] || '') === 'Extended' ||
        Boolean(row['SAP Item Code']);
      return {
        ...row,
        'SAP Extended': extended ? 'Extended' : 'Not yet',
        'SAP Pipeline': entry ? stageLabel[entry.stage] || entry.stage : '—',
        'SAP Item Code':
          row['SAP Item Code'] ||
          entry?.sapItemCode ||
          null,
      };
    });
  }

  /**
   * Full item object for the properties popup: one master row + all shops
   * and all store locations (no TOP 1 loss). Caller selects a location for SAP extend.
   */
  async getItemDetail(rawMatId: number): Promise<ItemDetailPayload> {
    if (!Number.isFinite(rawMatId) || rawMatId <= 0) {
      throw new BadRequestException('Invalid RawMatID');
    }

    if (this.useMock()) {
      const option = MOCK_ITEMS.find((i) => i.rawMatId === rawMatId) || MOCK_ITEMS[0];
      return {
        item: {
          RawMatID: option.rawMatId,
          RawMatCode: option.rawMatCode,
          RawMatName: option.rawMatName,
          Description: option.rawMatName,
          'Item Category':
            MOCK_CATEGORIES.find((c) => c.subGrnTypeIds.includes(option.grnTypeId || -1))
              ?.grnType || '—',
          'Main Category': 'Rawmaterial',
          UOM: 'EA',
          PurchaseUom: 'EA',
          LocationCount: 2,
          ShopCount: 2,
        },
        shops: [
          { shopId: 1, shopName: 'Machine Shop', itemSubCategory: 'Tooling' },
          { shopId: 2, shopName: 'Stores', itemSubCategory: 'Consumable' },
        ],
        locations: [
          {
            key: '14',
            locationId: 14,
            locationName: 'Unit-1',
            sapPlantCode: '2001',
            storageLocation: 'WUNM',
            locationMaxLevel: 100,
            locationMinLevel: 10,
            locationLeadTime: 3,
            locationBatchSize: 1,
            locationReorderLevel: 15,
            locationMinMaxReqd: 'Y',
          },
          {
            key: '3',
            locationId: 3,
            locationName: 'Unit-2',
            sapPlantCode: '2004',
            storageLocation: 'MXST',
            locationMaxLevel: 50,
            locationMinLevel: 5,
            locationLeadTime: 7,
            locationBatchSize: 2,
            locationReorderLevel: 8,
            locationMinMaxReqd: 'Y',
          },
        ],
      };
    }

    try {
      const itemRows = await this.db.run(this.dbName(), async (request) => {
        request.input('rawMatId', sql.Int, rawMatId);
        return request.query(`
          SELECT TOP 1
            R.RawMatID,
            R.RawMatCode,
            R.RawMatName,
            CASE
              WHEN InspecReq = 0 THEN 'Inspection Not Reqired'
              ELSE 'Inspection Required'
            END AS [Inspection Reqired],
            R.Description,
            ISNULL(mainCat.GrnType, parentCat.GrnType) AS [Main Category],
            IGT.GrnType AS [Item Category],
            IGT.Prefix,
            R.UOM,
            R.PurchaseUom,
            R.Iscreateproduct AS [Manufactured],
            R.Weight,
            R.WeightUom,
            R.LeadTime,
            R.PercofExcp AS Tolerance,
            R.InspecReq,
            R.InspCriteria,
            R.SpecificationNo,
            R.DrawingNo,
            hsn.HSNCode,
            s.Name,
            R.Saleable,
            R.Max_level,
            R.Min_level,
            R.EntryComputer,
            empcode + ' | ' + empname AS EntryBy,
            DrawAttach AS Attachment
          FROM dbo.RawMaterial R
          INNER JOIN Invent_GrnType IGT ON R.GrnTypeId = IGT.GrnTypeId
          OUTER APPLY (
            SELECT TOP 1 igtm.GrnType
            FROM Invent_GrnType igtm
            WHERE CHARINDEX(
                    CONCAT(',', IGT.GrnTypeId, ','),
                    CONCAT(',', igtm.SubgrntypeIds, ',')
                  ) > 0
              AND igtm.GrnParentlevel = 4
          ) mainCat
          OUTER APPLY (
            SELECT TOP 1 igtm1.GrnType
            FROM Invent_GrnType igtm1
            WHERE CHARINDEX(
                    CONCAT(',', IGT.GrnTypeId, ','),
                    CONCAT(',', igtm1.SubgrntypeIds, ',')
                  ) > 0
              AND igtm1.GrnParentlevel = 0
          ) parentCat
          LEFT JOIN Employee e ON e.EmpId = R.EntryEmpId
          LEFT JOIN GST_HSN_SAC_NO hsn ON hsn.Hsn_Sac_ID = R.HSN_SAC_ID
          LEFT JOIN [icsoftledger].dbo.accounts s ON R.AccExpId = s.ID
          WHERE R.RawMatID = @rawMatId
            AND R.active = 'Y'
        `);
      });

      if (!itemRows.length) {
        throw new BadRequestException(`Item RawMatID ${rawMatId} not found`);
      }

      const shopRows = await this.db.run(this.dbName(), async (request) => {
        request.input('rawMatId', sql.Int, rawMatId);
        return request.query(`
          SELECT DISTINCT
            ir.Shop AS shopId,
            mis.ShopName AS shopName,
            IGTa.GrnType AS itemSubCategory
          FROM Invent_Rawmaterial ir
          LEFT JOIN M_Item_shop mis ON mis.ShopId = ir.Shop
          LEFT JOIN Invent_GrnType IGTa ON ir.item_sub_category = IGTa.GrnTypeId
          WHERE ir.Af_ID = @rawMatId
          ORDER BY mis.ShopName
        `);
      });

      const locationRows = await this.db.run(this.dbName(), async (request) => {
        request.input('rawMatId', sql.Int, rawMatId);
        return request.query(`
          SELECT
            ill.LocationId AS locationId,
            c.Location AS locationName,
            CASE
              WHEN ill.LocationId = 14 THEN '2001'
              ELSE spl.sap_plantcode
            END AS sapPlantCode,
            CASE
              WHEN ill.LocationId = 14 THEN 'WUNM'
              WHEN spl.sap_plantcode = '3001' THEN 'MXST'
              ELSE sl.location_code
            END AS storageLocation,
            ill.LocationMaxLevel AS locationMaxLevel,
            ill.LocationMinLevel AS locationMinLevel,
            ill.LocationLeadTime AS locationLeadTime,
            ill.LocationBatchSize AS locationBatchSize,
            ill.LocationReorderLevel AS locationReorderLevel,
            ill.LocationMinMaxReqd AS locationMinMaxReqd
          FROM Item_Location_Link ill
          LEFT JOIN Company c ON c.CompanyID = ill.LocationId
          LEFT JOIN sap_plant_location_mapping spl ON spl.companyid = ill.LocationId
          OUTER APPLY (
            SELECT TOP 1 ssl.location_code
            FROM sap_storage_location ssl
            WHERE ssl.plant_code = CASE
              WHEN ill.LocationId = 14 THEN '2001'
              ELSE ISNULL(spl.sap_plantcode, '')
            END
            ORDER BY ssl.location_code
          ) sl
          WHERE ill.RawMatId = @rawMatId
          ORDER BY c.Location, ill.LocationId
        `);
      });

      const shops: ItemShopLink[] = shopRows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          shopId: r.shopId != null ? Number(r.shopId) : null,
          shopName: r.shopName != null ? String(r.shopName) : null,
          itemSubCategory:
            r.itemSubCategory != null ? String(r.itemSubCategory) : null,
        };
      });

      const locations: ItemStoreLocation[] = locationRows.map((row) => {
        const r = row as Record<string, unknown>;
        const locationId = Number(r.locationId);
        return {
          key: String(locationId),
          locationId,
          locationName: r.locationName != null ? String(r.locationName) : null,
          sapPlantCode: r.sapPlantCode != null ? String(r.sapPlantCode) : null,
          storageLocation:
            r.storageLocation != null ? String(r.storageLocation) : null,
          locationMaxLevel:
            r.locationMaxLevel != null ? Number(r.locationMaxLevel) : null,
          locationMinLevel:
            r.locationMinLevel != null ? Number(r.locationMinLevel) : null,
          locationLeadTime:
            r.locationLeadTime != null ? Number(r.locationLeadTime) : null,
          locationBatchSize:
            r.locationBatchSize != null ? Number(r.locationBatchSize) : null,
          locationReorderLevel:
            r.locationReorderLevel != null
              ? Number(r.locationReorderLevel)
              : null,
          locationMinMaxReqd:
            r.locationMinMaxReqd != null ? String(r.locationMinMaxReqd) : null,
        };
      });

      const item = itemRows[0] as Record<string, unknown>;
      item.LocationCount = locations.length;
      item.ShopCount = shops.length;

      return { item, shops, locations };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new ServiceUnavailableException(
        `Item detail query failed: ${(err as Error).message}`,
      );
    }
  }
}
