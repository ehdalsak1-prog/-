import { MaterialItem, MaterialSheet } from '../App';

export const GOANRI_SHEET_ID = 'sheet-yongin-direct';

export function createGoanriSheet(): MaterialSheet {
  const baseTime = 1761800000000;

  const rawRows: Array<{
    name: string;
    spec?: string;
    qty: number;
    unit: string;
    packQty?: number;
    subUnit?: string;
    date: string;
    remarks?: string;
  }> = [
    {
      name: 'STEEL PIPE',
      spec: '40A*3.2T*520L',
      qty: 4000,
      unit: 'EA',
      date: '2026-11-02',
      remarks: '3파렛트',
    },
    {
      name: '150 우물정자 클램프',
      spec: '4.5T*150*47',
      qty: 800,
      unit: 'EA',
      date: '2026-11-02',
      remarks: '',
    },
    {
      name: '150 우물정자 클램프',
      spec: '6T*150*22',
      qty: 800,
      unit: 'EA',
      date: '2026-11-02',
      remarks: '',
    },
    {
      name: '핸드파레트',
      spec: '3TON [ SY-3.0LL]',
      qty: 5,
      unit: 'EA',
      date: '2026-11-02',
      remarks: '',
    },
    {
      name: '핸드파레트',
      spec: '5TON [SY-5.0LL]',
      qty: 4,
      unit: 'EA',
      date: '2026-11-02',
      remarks: '',
    },
    {
      name: '핸드파레트',
      spec: '5TON [SY-5.0LL-2000]',
      qty: 2,
      unit: 'EA',
      date: '2026-11-02',
      remarks: '',
    },
    {
      name: 'HEAD BEAM',
      spec: '200(1:1)',
      qty: 500,
      unit: 'EA',
      date: '2026-11-03',
      remarks: '',
    },
    {
      name: 'STEEL PIPE',
      spec: '40A*3.2T*420L',
      qty: 1000,
      unit: 'EA',
      date: '2026-11-03',
      remarks: '',
    },
    {
      name: 'STEEL PIPE',
      spec: '40A*3.2T*520L',
      qty: 2000,
      unit: 'EA',
      date: '2026-11-03',
      remarks: '',
    },
    // 2차 반입: 오늘날짜 최신 반입 목록
    {
      name: 'STEEL PIPE',
      spec: '40A*3.2T*6000L',
      qty: 25,
      unit: '파레트',
      packQty: 61,
      subUnit: 'EA',
      date: '2026-11-06',
      remarks: '1파레트 = 61EA',
    },
    {
      name: 'STEEL PIPE',
      spec: '40A*3.2T*5000L',
      qty: 10,
      unit: '파레트',
      packQty: 61,
      subUnit: 'EA',
      date: '2026-11-06',
      remarks: '1파레트 = 61EA',
    },
    {
      name: 'STEEL PIPE',
      spec: '40A*3.2T*4000L',
      qty: 5,
      unit: '파레트',
      packQty: 61,
      subUnit: 'EA',
      date: '2026-11-06',
      remarks: '1파레트 = 61EA',
    },
    {
      name: 'STEEL PIPE',
      spec: '80A*3.6T*6000L',
      qty: 3,
      unit: '파레트',
      packQty: 28,
      subUnit: 'EA',
      date: '2026-11-06',
      remarks: '1파레트 = 28EA',
    },
    {
      name: '150 우물정자 클램프',
      spec: '150',
      qty: 5,
      unit: '마대',
      packQty: 100,
      subUnit: 'EA',
      date: '2026-11-06',
      remarks: '1마대 = 100EA',
    },
    {
      name: '150 우물정자 클램프',
      spec: '150',
      qty: 1,
      unit: '마대',
      packQty: 30,
      subUnit: 'EA',
      date: '2026-11-06',
      remarks: '1마대 = 30EA',
    },
    {
      name: '핸드파레트',
      spec: '2.5톤',
      qty: 1,
      unit: '대',
      date: '2026-11-06',
      remarks: '',
    },
    {
      name: 'H-BEAM',
      spec: '200*200*8*12',
      qty: 2,
      unit: '본',
      date: '2026-11-06',
      remarks: '',
    },
    {
      name: 'STEEL PIPE',
      spec: '40A*3.2T*520L',
      qty: 2000,
      unit: 'EA',
      date: '2026-11-06',
      remarks: '',
    },
  ];

  const items: MaterialItem[] = rawRows.map((r, idx) => ({
    id: `goanri-seed-${idx + 1}`,
    name: r.name,
    spec: r.spec || '-',
    quantity: r.qty,
    unit: r.unit,
    packQty: r.packQty,
    subUnit: r.subUnit,
    isCompleted: false,
    location: '',
    remarks: r.remarks || '',
    date: r.date,
    supplier: '',
    createdAt: baseTime + idx * 10,
    slipId: idx < 9 ? 'seed-slip-goanri-1' : undefined,
  }));

  return {
    id: GOANRI_SHEET_ID,
    name: '고안리공장 납품 LIST',
    subtitle: '고안리공장(용인공장)으로 신규 발주·납품되어 반입되는 자재 목록',
    items,
  };
}

export function getLatestTodayGoanriItems(): MaterialItem[] {
  const baseTime = Date.now();
  const latestRows = [
    {
      name: 'STEEL PIPE',
      spec: '40A*3.2T*6000L',
      qty: 25,
      unit: '파레트',
      packQty: 61,
      subUnit: 'EA',
      date: '2026-11-06',
      remarks: '1파레트 = 61EA',
    },
    {
      name: 'STEEL PIPE',
      spec: '40A*3.2T*5000L',
      qty: 10,
      unit: '파레트',
      packQty: 61,
      subUnit: 'EA',
      date: '2026-11-06',
      remarks: '1파레트 = 61EA',
    },
    {
      name: 'STEEL PIPE',
      spec: '40A*3.2T*4000L',
      qty: 5,
      unit: '파레트',
      packQty: 61,
      subUnit: 'EA',
      date: '2026-11-06',
      remarks: '1파레트 = 61EA',
    },
    {
      name: 'STEEL PIPE',
      spec: '80A*3.6T*6000L',
      qty: 3,
      unit: '파레트',
      packQty: 28,
      subUnit: 'EA',
      date: '2026-11-06',
      remarks: '1파레트 = 28EA',
    },
    {
      name: '150 우물정자 클램프',
      spec: '150',
      qty: 5,
      unit: '마대',
      packQty: 100,
      subUnit: 'EA',
      date: '2026-11-06',
      remarks: '1마대 = 100EA',
    },
    {
      name: '150 우물정자 클램프',
      spec: '150',
      qty: 1,
      unit: '마대',
      packQty: 30,
      subUnit: 'EA',
      date: '2026-11-06',
      remarks: '1마대 = 30EA',
    },
    {
      name: '핸드파레트',
      spec: '2.5톤',
      qty: 1,
      unit: '대',
      date: '2026-11-06',
      remarks: '',
    },
    {
      name: 'H-BEAM',
      spec: '200*200*8*12',
      qty: 2,
      unit: '본',
      date: '2026-11-06',
      remarks: '',
    },
    {
      name: 'STEEL PIPE',
      spec: '40A*3.2T*520L',
      qty: 2000,
      unit: 'EA',
      date: '2026-11-06',
      remarks: '',
    },
  ];

  return latestRows.map((r, idx) => ({
    id: `item-today-${baseTime}-${idx + 1}`,
    name: r.name,
    spec: r.spec || '-',
    quantity: r.qty,
    unit: r.unit,
    packQty: r.packQty,
    subUnit: r.subUnit,
    isCompleted: false,
    location: '',
    remarks: r.remarks || '',
    date: r.date,
    supplier: '',
    createdAt: baseTime + idx * 10,
  }));
}
