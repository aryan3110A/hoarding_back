import multer from 'multer';
import path from 'path';
import fs from 'fs';

const installationDir = path.resolve(process.cwd(), 'uploads', 'installation');

function ensureDir(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    // ignore
  }
}

ensureDir(installationDir);

const storage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: any) => {
    ensureDir(installationDir);
    cb(null, installationDir);
  },
  filename: (_req: any, file: any, cb: any) => {
    const safeBase = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    const ext = path.extname(safeBase) || '';
    const name = path.basename(safeBase, ext);
    const finalName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${name}${ext}`;
    cb(null, finalName);
  },
});

function imageFileFilter(_req: any, file: any, cb: any) {
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return cb(null, true);
  cb(new Error('Only image uploads are allowed'));
}

export const installationProofUpload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: { files: 10, fileSize: 10 * 1024 * 1024 },
});
