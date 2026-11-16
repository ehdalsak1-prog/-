import { MaterialItem, MaterialSheet } from '../App';

export const CHEONGJU_YONGIN_SHEET_ID = 'sheet-cheongju-yongin';

export function createCheongjuYonginSheet(defaultDate = '2026-10-30'): MaterialSheet {
  const baseTime = 1761690000000;

  const rawRows: Array<{
    name: string;
    spec?: string;
    qty: number;
    unit: string;
    packQty?: number;
    subUnit?: string;
    remarks?: string;
  }> = [
    { name: '전동 지게차[SBF-25A]', spec: '2.5 Ton', qty: 1, unit: '개' },
    { name: '전동 지게차 충전기', spec: '380V', qty: 1, unit: 'EA' },
    { name: '지게차 충전기함[노란색]', spec: '70*60*1250H', qty: 1, unit: 'EA' },
    { name: '40A BASE', spec: '-', qty: 9, unit: '파레트', packQty: 630, subUnit: 'EA' },
    { name: '80A PIPE_200 EA & 락링_200 EA', spec: '-', qty: 1, unit: '파레트' },
    { name: '80A POST', spec: '-', qty: 1, unit: '파레트', packQty: 440, subUnit: 'EA' },
    { name: '이동식 겐트리', spec: '-', qty: 2, unit: '파레트' },
    { name: '대형 콤프레셔', spec: '-', qty: 1, unit: 'EA' },
    { name: '소형 콤프레셔', spec: '-', qty: 1, unit: 'EA' },
    { name: '공장동 휴게실 책상', spec: '-', qty: 2, unit: 'EA' },
    { name: '공장동 휴게공간 파티션', spec: '-', qty: 1, unit: 'EA' },
    { name: '현황판[대형]', spec: '-', qty: 8, unit: 'EA' },
    { name: '현황판[소형]', spec: '-', qty: 4, unit: 'EA' },
  ];

  const items: MaterialItem[] = rawRows.map((r, idx) => ({
    id: `cheongju-seed-${idx + 1}`,
    name: r.name,
    spec: r.spec || '-',
    quantity: r.qty,
    unit: r.unit,
    packQty: r.packQty,
    subUnit: r.subUnit,
    isCompleted: false,
    location: '',
    remarks: r.remarks || '',
    date: defaultDate,
    createdAt: baseTime + idx * 10,
    slipId: 'seed-slip-cheongju-1',
  }));

  return {
    id: CHEONGJU_YONGIN_SHEET_ID,
    name: '청주사업부 → 용인사업부 이전',
    subtitle: '청주사업부에서 용인사업부(고안리공장)로 이설·이전 반입하는 설비 및 자재 목록',
    items,
  };
}
