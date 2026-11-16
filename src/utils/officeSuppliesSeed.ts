import { MaterialItem, MaterialSheet } from '../App';

export const OFFICE_SUPPLIES_SHEET_ID = 'sheet-office-supplies';

export function createOfficeSuppliesSheet(defaultDate?: string): MaterialSheet {
  const dateStr = defaultDate || new Date().toISOString().split('T')[0];
  const baseTime = 1761700000000;

  const rawRows: Array<{
    name: string;
    spec?: string;
    qty: number;
    unit: string;
    remarks?: string;
  }> = [
    { name: 'A4 용지', qty: 5, unit: 'BOX' },
    { name: 'A3 용지', qty: 3, unit: 'BOX' },
    { name: 'A4 코팅지', qty: 1, unit: 'BOX' },
    { name: 'A3 코팅지', qty: 1, unit: 'BOX' },
    { name: '네임펜[종류별]', qty: 3, unit: '곽' },
    { name: '페인트 마카(빨강)', qty: 60, unit: 'EA', remarks: '타공보강 후 아이마킹용 · 1곽 - 12EA' },
    { name: '건전지', spec: 'AA', qty: 20, unit: 'BOX' },
    { name: '건전지', spec: 'AAA', qty: 20, unit: 'BOX' },
    { name: '건전지', spec: 'R20 1.5V D사이즈', qty: 10, unit: 'BOX' },
    { name: '현황판 부착 서류봉투', qty: 36, unit: 'EA' },
    { name: '보드마카(빨간색, 파란색)', qty: 2, unit: 'BOX', remarks: '각 1다스' },
    { name: '볼펜', qty: 1, unit: 'BOX' },
    { name: '형광펜', qty: 1, unit: 'BOX' },
    { name: '스테이플러', qty: 2, unit: 'EA' },
    { name: '스테이플러 심', qty: 1, unit: 'BOX' },
    { name: '투명 테이프', qty: 10, unit: 'EA', remarks: '문서·포장용' },
    { name: '사무용 가위', qty: 2, unit: 'EA', remarks: '공용 비치용' },
    { name: '사무용 커터칼', qty: 5, unit: 'EA', remarks: '공용 비치용' },
    { name: '파일 철', qty: 10, unit: 'EA', remarks: '문서 보관용' },
    { name: '라벨 스티커', qty: 1, unit: 'BOX', remarks: '문서·물품 분류용' },
    { name: '멀티탭(접지형)', spec: '5구', qty: 10, unit: 'EA', remarks: '사무기기 전원 연결용' },
    { name: '케이블 타이', qty: 1, unit: 'BOX', remarks: '전선 정리용' },
    { name: '물티슈', qty: 2, unit: 'BOX', remarks: '공용 공간 청소용' },
    { name: '손세정제', qty: 5, unit: 'EA', remarks: '공용 공간 위생용' },
    { name: '보드마카 지우개', qty: 2, unit: 'EA', remarks: '회의실 보드 사용용' },
    { name: '박스 테이프', qty: 20, unit: 'EA' },
    { name: '수정 테이프', qty: 5, unit: 'EA' },
    { name: '포스트잇', qty: 20, unit: 'EA' },
    { name: '펀칭기', qty: 0, unit: '-' },
    { name: '실버클립', qty: 0, unit: '-' },
    { name: '더블클립', qty: 0, unit: '-' },
    { name: '프릭션볼펜 리필', qty: 0, unit: '-' },
    { name: '정부화일', qty: 0, unit: '-' },
    { name: '문서보관상자', qty: 0, unit: '-' },
  ];

  const items: MaterialItem[] = rawRows.map((r, idx) => ({
    id: `office-seed-${idx + 1}`,
    name: r.name,
    spec: r.spec || '-',
    quantity: r.qty,
    unit: r.unit,
    isCompleted: false,
    location: '',
    remarks: r.remarks || '',
    date: dateStr,
    createdAt: baseTime + idx * 10,
  }));

  return {
    id: OFFICE_SUPPLIES_SHEET_ID,
    name: '사무용품',
    subtitle: '사무실 비치 및 공용 소모품 구매·반입 목록',
    items,
  };
}
