import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Keyboard, Search, AppWindow, Monitor } from 'lucide-react'
import { PageHeader, Empty } from '@/components/ui'
import { cn } from '@/lib/utils'

type Group = { key: string; items: [string, string, string][] } // [keys, en, ar]

const APP: Group[] = [
  { key: 'general', items: [
    ['Ctrl+K', 'Command palette', 'لوحة الأوامر'], ['Ctrl+,', 'Settings', 'الإعدادات'], ['Ctrl+B', 'Toggle sidebar', 'إظهار/إخفاء الشريط الجانبي'],
    ['Ctrl+Shift+D', 'Toggle dark/light theme', 'تبديل الوضع الداكن/الفاتح'], ['Ctrl+Shift+L', 'Switch language', 'تبديل اللغة'], ['F11', 'Fullscreen', 'ملء الشاشة'], ['Esc', 'Close dialog / palette', 'إغلاق النافذة'],
  ] },
  { key: 'navigation', items: [
    ['Ctrl+1', 'Dashboard', 'لوحة التحكم'], ['Ctrl+2', 'Notes', 'الملاحظات'], ['Ctrl+3', 'Projects', 'المشاريع'], ['Ctrl+4', 'Tasks', 'المهام'], ['Ctrl+5', 'Files', 'الملفات'],
    ['Ctrl+6', 'Editor', 'المحرر'], ['Ctrl+7', 'Downloads', 'التنزيلات'], ['Ctrl+8', 'Network', 'الشبكة'], ['Ctrl+9', 'Compression', 'الضغط'],
  ] },
  { key: 'editing', items: [
    ['Ctrl+N', 'New in current section (note / task / project / file)', 'جديد في القسم الحالي (ملاحظة / مهمة / مشروع / ملف)'], ['Ctrl+S', 'Save (editor)', 'حفظ (المحرر)'], ['Ctrl+Shift+S', 'Save as (editor)', 'حفظ باسم (المحرر)'], ['Ctrl+O', 'Open file (editor)', 'فتح ملف (المحرر)'], ['Ctrl+W', 'Close tab (editor)', 'إغلاق التبويب (المحرر)'],
    ['Ctrl+Tab', 'Next tab', 'التبويب التالي'], ['Ctrl+F', 'Find', 'بحث'], ['Ctrl+H', 'Replace', 'استبدال'], ['Shift+Alt+F', 'Format document', 'تنسيق المستند'], ['Alt+↑/↓', 'Move line', 'تحريك السطر'], ['Ctrl+/', 'Toggle comment', 'تعليق/إلغاء التعليق'], ['Ctrl+D', 'Add selection to next match', 'تحديد التطابق التالي'],
  ] },
  { key: 'explorer', items: [
    ['Enter', 'Open', 'فتح'], ['Backspace', 'Go up', 'المجلد الأعلى'], ['F2', 'Rename', 'إعادة تسمية'], ['Delete', 'Delete (Recycle Bin)', 'حذف (سلة المحذوفات)'], ['Shift+Delete', 'Delete permanently', 'حذف نهائي'],
    ['Ctrl+C / X / V', 'Copy / Cut / Paste', 'نسخ / قص / لصق'], ['Ctrl+A', 'Select all', 'تحديد الكل'], ['Ctrl+Shift+N', 'New folder', 'مجلد جديد'], ['F5', 'Refresh', 'تحديث'], ['Ctrl+L', 'Edit path', 'تعديل المسار'], ['Ctrl+Shift+C', 'Copy path', 'نسخ المسار'],
  ] },
]

const WIN: Group[] = [
  { key: 'general', items: [
    ['Win', 'Open Start menu', 'فتح قائمة ابدأ'], ['Win+A', 'Action Center', 'مركز الإجراءات'], ['Win+S', 'Search', 'البحث'], ['Win+I', 'Settings', 'الإعدادات'], ['Win+E', 'File Explorer', 'مستكشف الملفات'], ['Win+R', 'Run', 'تشغيل'],
    ['Win+L', 'Lock PC', 'قفل الجهاز'], ['Win+X', 'Quick Link menu', 'قائمة الروابط السريعة'], ['Win+V', 'Clipboard history', 'سجل الحافظة'], ['Win+.', 'Emoji panel', 'لوحة الرموز التعبيرية'], ['Win+G', 'Xbox Game Bar', 'شريط الألعاب'], ['Win+K', 'Connect (cast)', 'الاتصال والعرض'],
    ['Win+P', 'Projection mode', 'وضع العرض'], ['Win+U', 'Ease of Access', 'سهولة الوصول'], ['Win+Pause', 'System properties', 'خصائص النظام'], ['Win+Shift+S', 'Screenshot snip', 'قص لقطة شاشة'], ['Win+PrtScn', 'Save screenshot', 'حفظ لقطة الشاشة'], ['Win+H', 'Dictation', 'الإملاء الصوتي'],
    ['Ctrl+Shift+Esc', 'Task Manager', 'إدارة المهام'], ['Ctrl+Alt+Del', 'Security screen', 'شاشة الأمان'], ['Alt+F4', 'Close app', 'إغلاق التطبيق'], ['Win+Space', 'Switch keyboard layout', 'تبديل لغة الإدخال'], ['Alt+Shift', 'Switch input language', 'تبديل اللغة'],
  ] },
  { key: 'windowsMgmt', items: [
    ['Alt+Tab', 'Switch apps', 'التبديل بين التطبيقات'], ['Win+Tab', 'Task View', 'عرض المهام'], ['Win+D', 'Show desktop', 'إظهار سطح المكتب'], ['Win+M', 'Minimize all', 'تصغير الكل'], ['Win+Shift+M', 'Restore minimized', 'استعادة المصغرة'],
    ['Win+Home', 'Minimize others', 'تصغير النوافذ الأخرى'], ['Win+↑', 'Maximize', 'تكبير'], ['Win+↓', 'Minimize / restore', 'تصغير / استعادة'], ['Win+←/→', 'Snap left / right', 'التثبيت يساراً / يميناً'], ['Win+Shift+←/→', 'Move to other monitor', 'نقل لشاشة أخرى'],
    ['Win+1..9', 'Open taskbar app N', 'فتح تطبيق شريط المهام'], ['Win+T', 'Cycle taskbar', 'التنقل في شريط المهام'], ['Win+B', 'Focus notification area', 'التركيز على منطقة الإشعارات'], ['Alt+Space', 'Window menu', 'قائمة النافذة'], ['Alt+Esc', 'Cycle windows', 'التبديل بين النوافذ'], ['Win+,', 'Peek at desktop', 'إلقاء نظرة على سطح المكتب'],
  ] },
  { key: 'virtualDesktops', items: [
    ['Win+Ctrl+D', 'New virtual desktop', 'سطح مكتب افتراضي جديد'], ['Win+Ctrl+←/→', 'Switch desktop', 'تبديل سطح المكتب'], ['Win+Ctrl+F4', 'Close desktop', 'إغلاق سطح المكتب'],
  ] },
  { key: 'explorer', items: [
    ['Ctrl+N', 'New window', 'نافذة جديدة'], ['Ctrl+Shift+N', 'New folder', 'مجلد جديد'], ['Alt+↑', 'Go up', 'المجلد الأعلى'], ['Alt+←/→', 'Back / Forward', 'رجوع / تقدم'], ['Alt+D', 'Address bar', 'شريط العنوان'], ['Ctrl+E / F3', 'Search box', 'مربع البحث'],
    ['F2', 'Rename', 'إعادة تسمية'], ['F5', 'Refresh', 'تحديث'], ['Alt+Enter', 'Properties', 'الخصائص'], ['Alt+P', 'Preview pane', 'لوحة المعاينة'], ['Shift+F10', 'Context menu', 'قائمة السياق'], ['Ctrl+Shift+1..8', 'Change view', 'تغيير طريقة العرض'], ['Ctrl+Mouse wheel', 'Change icon size', 'تغيير حجم الأيقونات'], ['Num Lock+*', 'Expand all subfolders', 'توسيع كل المجلدات'],
  ] },
  { key: 'office', items: [
    ['Ctrl+C / X / V', 'Copy / Cut / Paste', 'نسخ / قص / لصق'], ['Ctrl+Z / Y', 'Undo / Redo', 'تراجع / إعادة'], ['Ctrl+A', 'Select all', 'تحديد الكل'], ['Ctrl+F', 'Find', 'بحث'], ['Ctrl+S', 'Save', 'حفظ'], ['Ctrl+P', 'Print', 'طباعة'],
    ['Ctrl+B / I / U', 'Bold / Italic / Underline', 'عريض / مائل / تحته خط'], ['Ctrl+←/→', 'Move by word', 'التحرك كلمة كلمة'], ['Ctrl+Backspace', 'Delete word', 'حذف كلمة'], ['Shift+Arrows', 'Select text', 'تحديد النص'], ['Ctrl+Home/End', 'Start / end of document', 'بداية / نهاية المستند'], ['Ctrl+Shift+V', 'Paste plain text', 'لصق نص فقط'],
  ] },
  { key: 'cmd', items: [
    ['Ctrl+C', 'Abort command', 'إلغاء الأمر'], ['Ctrl+V', 'Paste', 'لصق'], ['Ctrl+M', 'Mark mode', 'وضع التحديد'], ['Alt+F4', 'Close', 'إغلاق'], ['Tab', 'Autocomplete path', 'إكمال المسار'], ['↑/↓', 'Command history', 'سجل الأوامر'], ['F7', 'History list', 'قائمة السجل'], ['Ctrl+Shift+T', 'New tab (Terminal)', 'تبويب جديد'], ['Alt+Enter', 'Fullscreen', 'ملء الشاشة'],
  ] },
  { key: 'browser', items: [
    ['Ctrl+T', 'New tab', 'تبويب جديد'], ['Ctrl+W', 'Close tab', 'إغلاق التبويب'], ['Ctrl+Shift+T', 'Reopen closed tab', 'إعادة فتح التبويب'], ['Ctrl+Tab', 'Next tab', 'التبويب التالي'], ['Ctrl+L', 'Address bar', 'شريط العنوان'], ['Ctrl+D', 'Bookmark', 'إشارة مرجعية'],
    ['Ctrl+H', 'History', 'السجل'], ['Ctrl+J', 'Downloads', 'التنزيلات'], ['Ctrl+Shift+N', 'Incognito', 'التصفح الخفي'], ['F12', 'Developer tools', 'أدوات المطور'], ['Ctrl+ + / -', 'Zoom', 'تكبير / تصغير'], ['F5 / Ctrl+F5', 'Reload / hard reload', 'تحديث / تحديث كامل'],
  ] },
  { key: 'accessibility', items: [
    ['Win+ +', 'Magnifier zoom in', 'تكبير المكبّر'], ['Win+Esc', 'Close Magnifier', 'إغلاق المكبّر'], ['Win+Ctrl+Enter', 'Narrator', 'الراوي'], ['Win+Ctrl+C', 'Color filters', 'فلاتر الألوان'], ['Left Alt+Left Shift+PrtScn', 'High contrast', 'التباين العالي'], ['Left Alt+Left Shift+Num Lock', 'Mouse keys', 'مفاتيح الفأرة'],
    ['Shift ×5', 'Sticky keys', 'المفاتيح اللاصقة'], ['PrtScn', 'Copy screen', 'نسخ الشاشة'], ['Alt+PrtScn', 'Copy active window', 'نسخ النافذة النشطة'], ['Win+Alt+R', 'Record (Game Bar)', 'تسجيل الشاشة'],
  ] },
]

export default function Shortcuts() {
  const { t, i18n } = useTranslation()
  const ar = i18n.language.startsWith('ar')
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'app' | 'win'>('app')
  const groups = tab === 'app' ? APP : WIN
  const filtered = useMemo(() => groups.map((g) => ({ ...g, items: g.items.filter(([k, en, a]) => !q || (k + en + a).toLowerCase().includes(q.toLowerCase())) })).filter((g) => g.items.length), [groups, q])

  return (
    <div className="flex flex-col h-full page-enter">
      <PageHeader title={t('shortcuts.title')} icon={<Keyboard />}>
        <div className="relative"><Search size={14} className="absolute start-3 top-3 opacity-50" /><input className="input ps-9 w-64" placeholder={t('shortcuts.searchShortcuts')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="flex gap-1 p-1 rounded-xl bg-surface-200">
          <button className={cn('btn-ghost text-sm', tab === 'app' && 'bg-surface-300')} onClick={() => setTab('app')}><AppWindow size={14} /> {t('shortcuts.app')}</button>
          <button className={cn('btn-ghost text-sm', tab === 'win' && 'bg-surface-300')} onClick={() => setTab('win')}><Monitor size={14} /> {t('shortcuts.windows')}</button>
        </div>
      </PageHeader>
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? <Empty icon={<Keyboard size={40} />} text={t('common.empty')} /> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 stagger">
            {filtered.map((g) => (
              <section key={g.key} className="card p-4">
                <h3 className="font-semibold mb-3 text-accent">{t(`shortcuts.${g.key}`)}</h3>
                <div className="space-y-1">
                  {g.items.map(([k, en, a]) => (
                    <div key={k + en} className="flex items-center justify-between gap-3 py-1.5 border-b border-surface-300/50 last:border-0">
                      <span className="text-sm">{ar ? a : en}</span>
                      <span className="flex gap-1 shrink-0" dir="ltr">{k.split('+').map((p, i) => <kbd key={i} className="kbd">{p.trim()}</kbd>)}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
