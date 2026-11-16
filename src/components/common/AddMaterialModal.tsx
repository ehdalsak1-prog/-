import React, { useEffect, useState } from 'react';
import { Boxes, Plus, X } from 'lucide-react';
import { ItemKind } from '../../types/erp';

interface AddMaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddMaterial: (params: {
    name: string;
    specification: string;
    unit: string;
    kind: ItemKind;
    initialStock: number;
    minimumStock: number;
    notes: string;
  }) => string | void;
  onCreated?: (itemId: string, itemName: string) => void;
}

export const AddMaterialModal: React.FC<AddMaterialModalProps> = ({
  isOpen,
  onClose,
  onAddMaterial,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [spec, setSpec] = useState('');
  const [kind, setKind] = useState<ItemKind>('RAW');
  const [unit, setUnit] = useState('EA');
  const [initialStock, setInitialStock] = useState('0');
  const [minimumStock, setMinimumStock] = useState('1000');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName('');
      setSpec('');
      setKind('RAW');
      setUnit('EA');
      setInitialStock('0');
      setMinimumStock('1000');
      setNotes('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const createdId = onAddMaterial({
      name: trimmedName,
      specification: spec.trim() || '-',
      unit: unit.trim() || 'EA',
      kind,
      initialStock: Math.max(0, parseInt(initialStock.replace(/,/g, ''), 10) || 0),
      minimumStock: Math.max(0, parseInt(minimumStock.replace(/,/g, ''), 10) || 0),
      notes: notes.trim(),
    });

    if (onCreated && typeof createdId === 'string') {
      onCreated(createdId, trimmedName);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[1px]">
      <div className="w-full max-w-lg bg-white dark:bg-[#1E232D] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
              <Boxes size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                신규 자재 추가
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                등록 즉시 재고 현황, 자재 입고 및 BOM 설정에 반영됩니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                자재명 *
              </label>
              <input
                type="text"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 스프링 와셔, U볼트"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                규격
              </label>
              <input
                type="text"
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                placeholder="예: M10, 520L"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                구분
              </label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as ItemKind)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 cursor-pointer"
              >
                <option value="RAW">원자재</option>
                <option value="INTERMEDIATE">중간제품</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                단위
              </label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 cursor-pointer"
              >
                <option value="EA">EA</option>
                <option value="SET">SET</option>
                <option value="KG">KG</option>
                <option value="M">M</option>
                <option value="BOX">BOX</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                초기 재고
              </label>
              <input
                type="number"
                min="0"
                value={initialStock}
                onChange={(e) => setInitialStock(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono font-bold text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                최소 재고
              </label>
              <input
                type="number"
                min="0"
                value={minimumStock}
                onChange={(e) => setMinimumStock(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono font-bold text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              비고 / 용도 메모 (선택)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="예: 40A POST 추가 보강 자재"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="pt-2 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-250 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 flex items-center space-x-1.5 cursor-pointer"
            >
              <Plus size={16} />
              <span>자재 추가하기</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
