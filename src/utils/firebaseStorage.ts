import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { storage, sanitizeFirestoreId, SHARED_LEDGER_ID } from '../firebase';

export interface UploadedSlipAsset {
  imageUrl: string;
  storagePath: string;
  fileSize: number;
}

const MAX_SLIP_FILE_BYTES = 15 * 1024 * 1024; // 15MB (matches storage.rules)
const ALLOWED_MIME_PREFIXES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/avif',
  'application/pdf',
  'application/octet-stream',
];

function dataUrlToBlob(dataUrl: string): { blob: Blob; contentType: string; ext: string } {
  const parts = dataUrl.split(',');
  const header = parts[0] || '';
  const mimeMatch = header.match(/data:([^;]+);/);
  const contentType = mimeMatch ? mimeMatch[1].toLowerCase() : 'image/jpeg';
  const base64 = parts[1] || '';
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const ext =
    contentType.includes('png')
      ? 'png'
      : contentType.includes('webp')
      ? 'webp'
      : contentType.includes('pdf')
      ? 'pdf'
      : 'jpg';
  return {
    blob: new Blob([bytes], { type: contentType }),
    contentType,
    ext,
  };
}

function getFileExtFromName(fileName?: string, mimeType?: string): string {
  const extMatch = (fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  if (extMatch && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'bmp', 'avif', 'pdf'].includes(extMatch[1])) {
    return extMatch[1] === 'jpeg' ? 'jpg' : extMatch[1];
  }
  if (mimeType?.includes('png')) return 'png';
  if (mimeType?.includes('webp')) return 'webp';
  if (mimeType?.includes('pdf')) return 'pdf';
  return 'jpg';
}

function validateUploadPayload(blob: Blob, contentType: string, fileName?: string) {
  if (blob.size <= 0) {
    throw new Error('빈 파일은 업로드할 수 없습니다.');
  }
  if (blob.size > MAX_SLIP_FILE_BYTES) {
    throw new Error('첨부파일 크기는 15MB 이하만 업로드할 수 있습니다.');
  }
  const cleanName = (fileName || '').toLowerCase();
  if (/\.(html|htm|js|mjs|svg|exe|sh|bat|cmd|php)$/i.test(cleanName)) {
    throw new Error('보안상 허용되지 않는 파일 형식입니다.');
  }
  const lowerType = (contentType || '').toLowerCase();
  if (lowerType.includes('svg') || !ALLOWED_MIME_PREFIXES.includes(lowerType)) {
    throw new Error(`허용되지 않는 파일 유형(${contentType || '알 수 없음'})입니다. 이미지 또는 PDF만 가능합니다.`);
  }
}

/**
 * Uploads a slip image or attachment (File, Blob, Data URL, or URL)
 * to the shared Firebase Storage path `ledgers/dain_yongin_shared/slips/{slipId}.{ext}`.
 */
export async function uploadSharedSlipAssetToStorage(
  slipId: string,
  source: File | Blob | string,
  fileName?: string,
  existingStoragePath?: string
): Promise<UploadedSlipAsset> {
  const safeSlipId = sanitizeFirestoreId(slipId, 'slip');

  // If already uploaded to the shared ledger Storage path, no re-upload needed
  if (
    typeof source === 'string' &&
    source.startsWith('https://firebasestorage.googleapis.com/') &&
    existingStoragePath &&
    existingStoragePath.startsWith(`ledgers/${SHARED_LEDGER_ID}/slips/`)
  ) {
    return {
      imageUrl: source,
      storagePath: existingStoragePath,
      fileSize: 0,
    };
  }

  let blob: Blob;
  let contentType = 'image/jpeg';
  let ext = getFileExtFromName(fileName);

  if (typeof source === 'string') {
    if (source.startsWith('data:')) {
      const converted = dataUrlToBlob(source);
      blob = converted.blob;
      contentType = converted.contentType;
      ext = converted.ext;
    } else if (source.startsWith('/') || source.startsWith('http')) {
      const resp = await fetch(source);
      if (!resp.ok) {
        throw new Error(`전표 이미지를 불러오지 못했습니다 (HTTP ${resp.status})`);
      }
      blob = await resp.blob();
      contentType = blob.type || 'image/png';
      ext = getFileExtFromName(source, contentType);
    } else {
      throw new Error('지원하지 않는 전표 이미지 형식입니다.');
    }
  } else {
    blob = source;
    contentType = source.type || 'image/jpeg';
    ext = getFileExtFromName(fileName || (source instanceof File ? source.name : undefined), contentType);
  }

  validateUploadPayload(blob, contentType, fileName);

  const storagePath = `ledgers/${SHARED_LEDGER_ID}/slips/${safeSlipId}.${ext}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, blob, {
    contentType,
    customMetadata: {
      ledgerId: SHARED_LEDGER_ID,
      slipId: safeSlipId,
      originalName: (fileName || '').slice(0, 200),
    },
  });

  const downloadUrl = await getDownloadURL(storageRef);

  return {
    imageUrl: downloadUrl,
    storagePath,
    fileSize: blob.size,
  };
}

/**
 * Deletes a slip file from the shared Firebase Storage path when removing a slip.
 */
export async function deleteSharedSlipAssetFromStorage(storagePath?: string): Promise<void> {
  if (!storagePath || !storagePath.trim()) return;
  if (!storagePath.startsWith(`ledgers/${SHARED_LEDGER_ID}/slips/`)) return;
  try {
    const storageRef = ref(storage, storagePath);
    await deleteObject(storageRef);
  } catch (err: any) {
    if (err?.code === 'storage/object-not-found') return;
    console.warn('Firebase Storage delete warning:', err);
  }
}
