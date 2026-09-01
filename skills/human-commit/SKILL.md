---
name: human-commit
description: Rules commit message human-readable dengan format 'nama_file: tipe subjek singkat'. Gunakan tipe feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
category: prompt-injection
version: 1.0.0
---

# Human Conventional Commits

Format: `nama_file: tipe subjek singkat`

## Tipe Commit
- `feat`: Menambah fitur baru
- `fix`: Memperbaiki bug
- `docs`: Perubahan dokumentasi saja
- `style`: Perubahan format/gaya kode (spasi, indentasi, dll), tanpa mengubah logika
- `refactor`: Merapikan/restrukturisasi kode tanpa mengubah perilaku
- `perf`: Perubahan yang meningkatkan performa
- `test`: Menambah atau memperbaiki test
- `build`: Perubahan pada sistem build atau dependency
- `ci`: Perubahan konfigurasi CI/CD
- `chore`: Pekerjaan rutin lain yang tidak masuk kategori di atas
- `revert`: Membatalkan commit sebelumnya

## Contoh
```
auth.py: feat tambah validasi token JWT
readme.md: docs perbarui panduan instalasi
utils.js: fix perbaiki bug pembulatan angka
```
