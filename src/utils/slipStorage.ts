/**
 * IndexedDB storage and image compression helper for receipt slips & delivery notes
 */

export interface StoredReceiptSlip {
  id: string; // e.g. "slip-1730761200000"
  title: string;
  documentType: string;
  supplierName: string;
  documentDate: string;
  receiverName?: string;
  totalAmount?: number;
  notes?: string;
  sheetId: string;
  sheetName: string;
  itemIds: string[];
  itemNames: string[];
  imageUrl: string; // compressed base64 data URL, asset path, or Firebase Storage download URL
  storagePath?: string; // Firebase Storage object path (e.g. users/{uid}/slips/{slipId}.jpg)
  fileName?: string;
  fileSize?: number;
  createdAt: number;
}

export const DEFAULT_SEED_SLIPS: StoredReceiptSlip[] = [
  {
    id: 'seed-slip-goanri-1',
    title: '고안리공장 납품 LIST 원본 전표',
    documentType: '납품서',
    supplierName: '',
    documentDate: '2026-11-04',
    receiverName: '(주)다인 용인사업부 (고안리공장)',
    totalAmount: 18500000,
    notes: '용인사업부 주소 : 경기도 용인시 처인구 백암면 고안로181번길 14-19 / 신규 발주 자재 반입 관리',
    sheetId: 'sheet-yongin-direct',
    sheetName: '고안리공장 납품 LIST',
    itemIds: [
      'goanri-seed-1',
      'goanri-seed-2',
      'goanri-seed-3',
      'goanri-seed-4',
      'goanri-seed-5',
      'goanri-seed-6',
      'goanri-seed-7',
      'goanri-seed-8',
      'goanri-seed-9',
    ],
    itemNames: [
      'STEEL PIPE',
      '150 우물정자 클램프',
      '핸드파레트',
      'HEAD BEAM',
      'H-BEAM',
    ],
    imageUrl: '/assets/aistudio/image_5f76f6ec.png',
    fileName: '고안리공장_납품_LIST_전표.png',
    createdAt: 1761800000000,
  },
  {
    id: 'seed-slip-cheongju-1',
    title: '청주사업부 → 용인사업부 이전 반출 전표',
    documentType: '이전 반출 전표',
    supplierName: '청주사업부 이설팀',
    documentDate: '2026-10-30',
    receiverName: '(주)다인 용인사업부',
    totalAmount: 42000000,
    notes: '청주공장에서 용인사업부(고안리공장)로 설비 및 이전 자재 반입 반출 대장',
    sheetId: 'sheet-cheongju-yongin',
    sheetName: '청주사업부 → 용인사업부 이전',
    itemIds: [
      'cheongju-seed-1',
      'cheongju-seed-2',
      'cheongju-seed-3',
      'cheongju-seed-4',
      'cheongju-seed-5',
      'cheongju-seed-6',
      'cheongju-seed-7',
      'cheongju-seed-8',
      'cheongju-seed-9',
      'cheongju-seed-10',
      'cheongju-seed-11',
      'cheongju-seed-12',
      'cheongju-seed-13',
    ],
    itemNames: [
      '전동 지게차[SBF-25A]',
      '전동 지게차 충전기',
      '지게차 충전기함[노란색]',
      '40A BASE',
      '80A PIPE_200 EA & 락링_200 EA',
      '80A POST',
      '이동식 겐트리',
      '대형 콤프레셔',
      '소형 콤프레셔',
      '락링',
      '볼트',
      '플랜지 너트',
    ],
    imageUrl: '/assets/aistudio/image_c537fa94.png',
    fileName: '청주사업부_용인사업부_이전_전표.png',
    createdAt: 1761700000000,
  },
  {
    id: 'seed-slip-cheongju-2',
    title: '청주공장 이설 자재 반출 및 인수확인서',
    documentType: '인수확인 전표',
    supplierName: '청주사업부',
    documentDate: '2026-10-29',
    receiverName: '(주)다인 용인사업부',
    notes: '전동지게차 및 40A BASE 9파레트(5,670 EA) 등 초기 이전분 확인 전표',
    sheetId: 'sheet-cheongju-yongin',
    sheetName: '청주사업부 → 용인사업부 이전',
    itemIds: [],
    itemNames: [
      '전동 지게차[SBF-25A]',
      '40A BASE',
      '80A PIPE',
      '현황판[대형]',
      '현황판[소형]',
    ],
    imageUrl: '/assets/aistudio/image_c6b64242.png',
    fileName: '청주_용인이전_반입반출대장_전표.png',
    createdAt: 1761690000000,
  },
];

const DB_NAME = 'FieldMaterialApp_DB';
const DB_VERSION = 1;
const STORE_NAME = 'receipt_slips';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB is not supported in this environment.'));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('sheetId', 'sheetId', { unique: false });
        store.createIndex('documentDate', 'documentDate', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function isImageFile(file: File | null | undefined): boolean {
  if (!file) return false;
  if (file.type && file.type.startsWith('image/')) return true;
  const name = (file.name || '').toLowerCase();
  return /\.(jpe?g|png|gif|webp|bmp|jfif|heic|heif|svg)$/i.test(name);
}

export async function saveSlipToDB(slip: StoredReceiptSlip): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(slip);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('IDB put error'));
      tx.onabort = () => reject(tx.error || new Error('IDB transaction aborted'));
    });
  } catch (error) {
    console.warn('IndexedDB save failed, keeping in runtime memory:', error);
  }

  // Backup up to 10 recent slips in localStorage if space permits
  try {
    localStorage.removeItem('field_backup_slips_cleared');
    const existingRaw = localStorage.getItem('field_backup_slips_v1');
    const list: StoredReceiptSlip[] = existingRaw ? JSON.parse(existingRaw) : [];
    const updated = [slip, ...list.filter((s) => s.id !== slip.id)].slice(0, 10);
    localStorage.setItem('field_backup_slips_v1', JSON.stringify(updated));
  } catch {
    // ignore localStorage quota error safely
  }
}

export async function getAllSlipsFromDB(): Promise<StoredReceiptSlip[]> {
  try {
    const isExplicitlyCleared =
      typeof window !== 'undefined' &&
      localStorage.getItem('field_backup_slips_cleared') === 'true';

    const db = await openDatabase();
    const stored = await new Promise<StoredReceiptSlip[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    if (stored && stored.length > 0) {
      stored.sort((a, b) => b.createdAt - a.createdAt);
      return stored;
    }

    if (isExplicitlyCleared) {
      return [];
    }

    // Auto-seed default slips on initial load so the archive is populated unless cleared!
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const slip of DEFAULT_SEED_SLIPS) {
        store.put(slip);
      }
    } catch (seedErr) {
      console.warn('Failed to seed initial slips in DB:', seedErr);
    }
    return DEFAULT_SEED_SLIPS;
  } catch (error) {
    console.warn('Failed to load slips from IndexedDB, checking localStorage backup:', error);
    try {
      if (
        typeof window !== 'undefined' &&
        localStorage.getItem('field_backup_slips_cleared') === 'true'
      ) {
        return [];
      }
      const existingRaw = localStorage.getItem('field_backup_slips_v1');
      if (existingRaw) {
        const parsed = JSON.parse(existingRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return DEFAULT_SEED_SLIPS;
  }
}

export async function getSlipFromDB(id: string): Promise<StoredReceiptSlip | null> {
  try {
    const isExplicitlyCleared =
      typeof window !== 'undefined' &&
      localStorage.getItem('field_backup_slips_cleared') === 'true';

    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          resolve(req.result);
        } else if (!isExplicitlyCleared) {
          const foundSeed = DEFAULT_SEED_SLIPS.find((s) => s.id === id);
          resolve(foundSeed || null);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    return null;
  }
}

export async function deleteSlipFromDB(id: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.error(`Failed to delete slip ${id} from IndexedDB:`, error);
  }

  try {
    const existingRaw = localStorage.getItem('field_backup_slips_v1');
    if (existingRaw) {
      const list: StoredReceiptSlip[] = JSON.parse(existingRaw);
      const updated = list.filter((s) => s.id !== id);
      localStorage.setItem('field_backup_slips_v1', JSON.stringify(updated));
      if (updated.length === 0) {
        localStorage.setItem('field_backup_slips_cleared', 'true');
      }
    }
  } catch {
    // ignore
  }
}

export async function clearAllSlipsFromDB(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (error) {
    console.error('Failed to clear slips from IndexedDB:', error);
  }

  try {
    localStorage.removeItem('field_backup_slips_v1');
    localStorage.setItem('field_backup_slips_cleared', 'true');
  } catch {
    // ignore
  }
}

/**
 * Compresses an image file or data URL to crisp web-ready JPEG (~200KB - 400KB)
 * while preserving maximum text readability for delivery notes and invoices.
 */
export function compressReceiptImage(
  source: File | string,
  maxDimension = 1920,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve) => {
    // String (URL or Data URL)
    if (typeof source === 'string') {
      if (!source.trim()) return resolve('');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;
          if (!width || !height) return resolve(source);

          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(source);

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        } catch {
          resolve(source);
        }
      };
      img.onerror = () => resolve(source);
      img.src = source;
      return;
    }

    // File or Blob
    const reader = new FileReader();
    reader.onerror = () => resolve('');
    reader.onload = () => {
      const rawDataUrl = reader.result as string;
      if (!rawDataUrl) return resolve('');

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;
          if (!width || !height) return resolve(rawDataUrl);

          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(rawDataUrl);

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          const compressed = canvas.toDataURL('image/jpeg', quality);
          resolve(compressed);
        } catch (err) {
          console.warn('Canvas compression error, falling back to raw data URL:', err);
          resolve(rawDataUrl);
        }
      };
      img.onerror = () => resolve(rawDataUrl);
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(source);
  });
}
