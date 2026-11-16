import { MaterialItem, getTotalConvertedQty } from '../App';

export interface ItemWithSheetEntry {
  sheetName: string;
  item: MaterialItem;
}

export interface AggregatedItemGroup {
  key: string;
  name: string;
  spec: string;
  suppliers: string[];
  latestSupplier: string;
  latestUnit: string;
  latestPackQty?: number;
  latestSubUnit?: string;
  entryCount: number;
  sheetNames: string[];
  inboundUnitSums: Record<string, number>;
  inboundSummaryQtyOnly: string;
  inboundSummaryWithUnit: string;
  singleInboundUnit: string | null;
  singleInboundQty: number | null;
  packDisplay: string;
  singlePackQty: number | null;
  singleSubUnit: string | null;
  totalUnitSums: Record<string, number>;
  totalSummaryText: string;
  singleTotalUnit: string | null;
  singleTotalQty: number | null;
  hasPackConversion: boolean;
  firstDate: string;
  latestDate: string;
  latestCreatedAt: number;
}

function normalizeUnitText(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed === '-') return '-';
  if (trimmed === '파렛트' || trimmed === '팔레트') return '파레트';
  if (trimmed.toLowerCase() === 'box' || trimmed === '박스') return 'BOX';
  if (trimmed.toLowerCase() === 'ea') return 'EA';
  return trimmed;
}

function normalizeSpecText(raw?: string): string {
  const trimmed = (raw || '').trim().replace(/\s+/g, ' ');
  return !trimmed || trimmed === '-' ? '-' : trimmed;
}

/**
 * Aggregates chronological inbound ledger entries by item (either by [품목명 + 규격] or [품목명 only]),
 * summing both 반입 수량 (Inbound Quantity) and 총 수량 (Total Converted Quantity),
 * while also tracking supplier (구매처) and latest template metadata for auto-favorites.
 */
export function aggregateMaterialItems(
  entries: ItemWithSheetEntry[],
  groupMode: 'name_and_spec' | 'name_only' = 'name_and_spec'
): AggregatedItemGroup[] {
  const map = new Map<
    string,
    {
      name: string;
      specs: Set<string>;
      primarySpec: string;
      supplierSet: Set<string>;
      latestSupplier: string;
      latestUnit: string;
      latestPackQty?: number;
      latestSubUnit?: string;
      entryCount: number;
      sheetSet: Set<string>;
      inboundUnitSums: Record<string, number>;
      packSignatures: Set<string>;
      firstPackQty: number | null;
      firstSubUnit: string | null;
      totalUnitSums: Record<string, number>;
      hasPackConversion: boolean;
      firstDate: string;
      latestDate: string;
      latestCreatedAt: number;
    }
  >();

  entries.forEach(({ sheetName, item }) => {
    const cleanName = (item.name || '').trim().replace(/\s+/g, ' ');
    if (!cleanName) return;

    const cleanSpec = normalizeSpecText(item.spec);
    const cleanSupplier = (item.supplier || '').trim();
    const key =
      groupMode === 'name_only'
        ? cleanName.toLowerCase()
        : `${cleanName.toLowerCase()}||${cleanSpec.toLowerCase()}`;

    let group = map.get(key);
    if (!group) {
      const initUnit = normalizeUnitText(item.unit || 'EA');
      group = {
        name: cleanName,
        specs: new Set<string>(),
        primarySpec: cleanSpec,
        supplierSet: new Set<string>(),
        latestSupplier: cleanSupplier && cleanSupplier !== '-' ? cleanSupplier : '',
        latestUnit: initUnit === '-' ? 'EA' : initUnit,
        latestPackQty: item.packQty && item.packQty > 0 ? item.packQty : undefined,
        latestSubUnit:
          item.packQty && item.packQty > 0 ? normalizeUnitText(item.subUnit || 'EA') : undefined,
        entryCount: 0,
        sheetSet: new Set<string>(),
        inboundUnitSums: {},
        packSignatures: new Set<string>(),
        firstPackQty: null,
        firstSubUnit: null,
        totalUnitSums: {},
        hasPackConversion: false,
        firstDate: item.date || '',
        latestDate: item.date || '',
        latestCreatedAt: item.createdAt || 0,
      };
      map.set(key, group);
    }

    group.entryCount += 1;
    if (sheetName) group.sheetSet.add(sheetName);
    if (cleanSpec !== '-') {
      group.specs.add(cleanSpec);
    }
    if (cleanSupplier && cleanSupplier !== '-') {
      group.supplierSet.add(cleanSupplier);
      group.latestSupplier = cleanSupplier;
    }

    const normU = normalizeUnitText(item.unit || '');
    if (normU && normU !== '-') {
      group.latestUnit = normU;
    }
    if (item.packQty && item.packQty > 0) {
      group.latestPackQty = item.packQty;
      const normSub = normalizeUnitText(item.subUnit || 'EA');
      group.latestSubUnit = normSub === '-' ? 'EA' : normSub;
    } else if (item.quantity > 0) {
      group.latestPackQty = undefined;
      group.latestSubUnit = undefined;
    }

    if ((item.createdAt || 0) >= group.latestCreatedAt) {
      group.latestCreatedAt = item.createdAt || 0;
    }

    if (item.date) {
      if (!group.firstDate || item.date < group.firstDate) {
        group.firstDate = item.date;
      }
      if (!group.latestDate || item.date > group.latestDate) {
        group.latestDate = item.date;
      }
    }

    if (item.quantity > 0) {
      const unitLabel = normalizeUnitText(item.unit || 'EA');
      const safeMainUnit = unitLabel === '-' ? 'EA' : unitLabel;

      group.inboundUnitSums[safeMainUnit] =
        Math.round(((group.inboundUnitSums[safeMainUnit] || 0) + item.quantity) * 1000) / 1000;

      const conv = getTotalConvertedQty(item);
      if (conv !== null && item.packQty && item.packQty > 0) {
        const subU = normalizeUnitText(item.subUnit || 'EA');
        const safeSubU = subU === '-' ? 'EA' : subU;
        group.hasPackConversion = true;
        group.packSignatures.add(`${item.packQty}::${safeSubU}`);
        if (group.firstPackQty === null) {
          group.firstPackQty = item.packQty;
          group.firstSubUnit = safeSubU;
        }
        group.totalUnitSums[safeSubU] =
          Math.round(((group.totalUnitSums[safeSubU] || 0) + conv) * 1000) / 1000;
      } else {
        group.packSignatures.add('NONE');
        group.totalUnitSums[safeMainUnit] =
          Math.round(((group.totalUnitSums[safeMainUnit] || 0) + item.quantity) * 1000) / 1000;
      }
    } else {
      group.packSignatures.add('ZERO');
    }
  });

  const results: AggregatedItemGroup[] = [];

  map.forEach((g, key) => {
    const specDisplay =
      groupMode === 'name_only'
        ? g.specs.size > 0
          ? Array.from(g.specs).join(', ')
          : '-'
        : g.primarySpec;

    const inboundUnits = Object.keys(g.inboundUnitSums);
    const singleInboundUnit = inboundUnits.length === 1 ? inboundUnits[0] : null;
    const singleInboundQty =
      singleInboundUnit !== null ? g.inboundUnitSums[singleInboundUnit] : null;

    const inboundSummaryWithUnit =
      inboundUnits.length === 0
        ? '-'
        : Object.entries(g.inboundUnitSums)
            .map(([u, q]) => `${q.toLocaleString()} ${u}`)
            .join(', ');

    const inboundSummaryQtyOnly =
      inboundUnits.length === 0
        ? '-'
        : singleInboundQty !== null
        ? singleInboundQty.toLocaleString()
        : inboundSummaryWithUnit;

    let packDisplay = '-';
    let singlePackQty: number | null = null;
    let singleSubUnit: string | null = null;
    const nonZeroPackSigs = Array.from(g.packSignatures).filter((s) => s !== 'ZERO');
    if (
      nonZeroPackSigs.length === 1 &&
      nonZeroPackSigs[0] !== 'NONE' &&
      g.firstPackQty !== null &&
      g.firstSubUnit !== null
    ) {
      singlePackQty = g.firstPackQty;
      singleSubUnit = g.firstSubUnit;
      packDisplay = `${singlePackQty.toLocaleString()} ${singleSubUnit}`;
    }

    const totalUnits = Object.keys(g.totalUnitSums);
    const singleTotalUnit = totalUnits.length === 1 ? totalUnits[0] : null;
    const singleTotalQty = singleTotalUnit !== null ? g.totalUnitSums[singleTotalUnit] : null;

    const totalSummaryText =
      totalUnits.length === 0
        ? '-'
        : Object.entries(g.totalUnitSums)
            .map(([u, q]) => `${q.toLocaleString()} ${u}`)
            .join(', ');

    results.push({
      key,
      name: g.name,
      spec: specDisplay,
      suppliers: Array.from(g.supplierSet),
      latestSupplier: g.latestSupplier,
      latestUnit: g.latestUnit,
      latestPackQty: g.latestPackQty,
      latestSubUnit: g.latestSubUnit,
      entryCount: g.entryCount,
      sheetNames: Array.from(g.sheetSet),
      inboundUnitSums: g.inboundUnitSums,
      inboundSummaryQtyOnly,
      inboundSummaryWithUnit,
      singleInboundUnit,
      singleInboundQty,
      packDisplay,
      singlePackQty,
      singleSubUnit,
      totalUnitSums: g.totalUnitSums,
      totalSummaryText,
      singleTotalUnit,
      singleTotalQty,
      hasPackConversion: g.hasPackConversion,
      firstDate: g.firstDate,
      latestDate: g.latestDate,
      latestCreatedAt: g.latestCreatedAt,
    });
  });

  return results;
}
