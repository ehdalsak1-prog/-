import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Printer,
  RotateCcw,
  Download,
  CheckCircle2,
} from 'lucide-react';
import { ErpAppState } from '../../types/erp';
import { exportErpExcel, ExportDatasetType } from '../../utils/erpExport';
import { ConfirmModal } from '../common/ConfirmModal';

interface ExportDataViewProps {
  state: ErpAppState;
  onResetToInitial: () => void;
}

const EXPORT_ITEMS: {
  type: ExportDatasetType;
  title: string;
  desc: string;
}[] = [
  {
    type: 'ALL',
    title: '전체 통합 엑셀 통합본 (7개 시트)',
    desc: '생산계획, 생산실적, 재고현황, 구매필요량, 입고내역, 재고수불부, BOM을 한 파일에 저장합니다.',
  },
  {
    type: 'PRODUCTION',
    title: '생산 실적 (.xlsx)',
    desc: '일자별 완제품 및 중간제품 생산 내역과 소모 자재 목록을 저장합니다.',
  },
  {
    type: 'INVENTORY',
    title: '현재 재고 현황 (.xlsx)',
    desc: '모든 원자재, 중간재, 완제품의 현재고 및 입고/사용/조정 누계를 저장합니다.',
  },
  {
    type: 'PURCHASE',
    title: '추가 구매 필요량 (.xlsx)',
    desc: '전체 목표 및 잔여 생산 기준 추가 발주 필요 수량을 저장합니다.',
  },
  {
    type: 'RECEIPTS',
    title: '자재 입고 내역 (.xlsx)',
    desc: '공급업체 및 날짜별 자재 반입 이력을 저장합니다.',
  },
  {
    type: 'LEDGER',
    title: '자재 재고 수불부 (.xlsx)',
    desc: '입고, 사용, 취소, 조정 등 전체 거래 추적 원장을 저장합니다.',
  },
  {
    type: 'PLAN',
    title: '생산 계획 현황 (.xlsx)',
    desc: '제품별 목표, 완료, 잔량, 진행률을 저장합니다.',
  },
  {
    type: 'BOM',
    title: '제품별 BOM 기준표 (.xlsx)',
    desc: '등록된 제품별 1EA당 자재 소요량 구조를 저장합니다.',
  },
];

export const ExportDataView: React.FC<ExportDataViewProps> = ({
  state,
  onResetToInitial,
}) => {
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleExport = (type: ExportDatasetType, title: string) => {
    exportErpExcel(state, type);
    setNotice(`${title} 파일 다운로드를 시작했습니다.`);
    setTimeout(() => setNotice(null), 3000);
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div className="bg-white dark:bg-[#1E232D] border border-emerald-200 dark:border-emerald-900 rounded-xl p-4 flex items-center space-x-3 shadow-2xs">
          <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{notice}</span>
        </div>
      )}

      {/* 엑셀 다운로드 카드 그리드 */}
      <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Excel 다운로드 및 보고서 인쇄
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              원하는 항목만 선택하거나 전체 데이터를 1개의 통합 엑셀 파일로 다운로드할 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 text-xs sm:text-sm font-bold rounded-lg border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 flex items-center space-x-1.5 cursor-pointer self-start sm:self-auto"
          >
            <Printer size={15} />
            <span>현재 화면 인쇄 / PDF</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-2">
          {EXPORT_ITEMS.map((item) => (
            <div
              key={item.type}
              className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${
                item.type === 'ALL'
                  ? 'border-slate-900 dark:border-slate-200 bg-slate-50/70 dark:bg-slate-800/60 md:col-span-2'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1E232D]'
              }`}
            >
              <div className="flex items-start space-x-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <FileSpreadsheet size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {item.title}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.desc}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleExport(item.type, item.title)}
                className="px-3.5 py-2 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 flex items-center space-x-1.5 shrink-0 cursor-pointer"
              >
                <Download size={14} />
                <span>다운로드</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 데이터 초기화 영역 */}
      <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            초기 기준 데이터로 되돌리기
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            현재 브라우저에 저장된 모든 입력 내역을 지우고 초기 설정(목표 11,000 EA · 기존 6,070 EA · 초기 재고)으로 복원합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="px-4 py-2 text-xs sm:text-sm font-bold rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-900/40 flex items-center space-x-1.5 shrink-0 cursor-pointer self-start sm:self-auto"
        >
          <RotateCcw size={15} />
          <span>초기 데이터 리셋</span>
        </button>
      </div>

      <ConfirmModal
        isOpen={confirmReset}
        title="초기 데이터로 재설정"
        description="정말로 현재까지의 모든 입고, 생산, 조정 기록을 초기화하고 초기 기준 데이터(목표 11,000 EA, 기존 실적 6,070 EA)로 되돌리시겠습니까?"
        confirmLabel="초기화 실행"
        onConfirm={() => {
          onResetToInitial();
          setConfirmReset(false);
          setNotice('초기 데이터로 안전하게 재설정되었습니다.');
          setTimeout(() => setNotice(null), 3000);
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
};
