# دليل مصدر DragonHub v1.1.0

هذه الحزمة تحتوي على ملفات السورس غير المبنية لبرنامج DragonHub. تم استبعاد `node_modules` و`dist` و`dist-electron` و`release` حتى تتمكن من تعديل الكود وإعادة تثبيت الاعتماديات وبناء البرنامج من جديد.

## المتطلبات

- Windows 10/11 ‏64-bit.
- Node.js 20 أو أحدث.
- npm.

## تثبيت الاعتماديات

افتح PowerShell داخل مجلد المشروع ثم نفّذ:

```powershell
npm install
```

## فحص المصدر

```powershell
npm run typecheck
```

## تشغيل وضع التطوير

```powershell
npm run dev
```

## بناء المشروع

```powershell
npm run build
```

## إنشاء المثبّت التقليدي والنسخة المحمولة

```powershell
npm run dist
```

ستظهر الملفات داخل:

```text
release/1.1.0/
```

## أهم أماكن التعديل

| المسار | الاستخدام |
|---|---|
| `src/renderer/pages/` | صفحات واجهة البرنامج |
| `src/renderer/components/` | المكونات المشتركة |
| `src/renderer/store/` | الحالة العامة للتطبيق |
| `src/renderer/i18n/` | ملفات الترجمة العربية والإنجليزية |
| `src/shared/types.ts` | الأنواع والعقود المشتركة |
| `electron/main/index.ts` | إنشاء نافذة Electron وتهيئة العملية الرئيسية |
| `electron/main/ipc.ts` | قنوات الاتصال بين الواجهة والعملية الرئيسية |
| `electron/main/services/` | خدمات الملفات والتنزيل والوسائط والضغط والخزنة |
| `electron/preload/` | الجسر الآمن بين Electron والواجهة |
| `build/icon.ico` | أيقونة البرنامج |
| `package.json` | الأوامر وإعدادات electron-builder |

## ملاحظات مهمة

لا تحذف إعدادات `contextIsolation` أو sandbox أو التحقق من المسارات دون فهم آثار ذلك على أمان التطبيق. عند تعديل الخزنة أو التشفير، اختبر استعادة البيانات بعناية ولا تستخدم بيانات حقيقية أثناء التجارب الأولى.

يجب ألا ترفع مجلد `node_modules` أو مجلدات البناء إلى GitHub. استخدم ملف `.gitignore` الموجود في الحزمة.

## رابط النسخة الجاهزة

لتحميل المثبّت المبني حاليًا:

[DragonHub Setup v1.1.0 — Windows x64](https://github.com/Ahmaddragon11/DragonHub/releases/download/1/DragonHub-Setup-1.1.0-win-x64.exe)
