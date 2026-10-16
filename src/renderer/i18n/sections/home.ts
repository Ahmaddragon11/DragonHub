/** Owned by the "dashboard + welcome" workstream. Deep-merged over the base
 *  en/ar dictionaries (see i18n/index.ts). Keep every key in BOTH en and ar. */
export default {
  en: {
    dashboard: {
      todayProgress: 'Today',
      getStarted: {
        title: 'Get started',
        subtitle: 'A few quick steps to make this hub yours.',
        progress: '{{done}} of {{total}} done',
        dismiss: 'Dismiss',
        stepNote: 'Write your first note',
        stepNoteHint: 'Capture an idea or something to remember.',
        stepTask: 'Add a task',
        stepTaskHint: 'Plan the next thing you need to do.',
        stepProject: 'Start a project',
        stepProjectHint: 'Group related ideas and tasks together.',
        stepPalette: 'Open the command palette',
        stepPaletteHint: 'Jump anywhere or run a command with Ctrl+K.',
      },
    },
    onboarding: {
      eyebrow: 'Welcome',
      step1: 'Language',
      step2: 'Appearance',
      step3: 'Features',
      readyTitle: 'You are all set',
      readyDesc: 'Your workspace is ready. Let’s dive in.',
      summaryTitle: 'Your setup',
      paletteHint: 'Tip: press Ctrl+K anywhere to search or run a command.',
    },
    about: {
      whatsNewBadge: 'New release',
      whatsNewHighlights: 'Here’s what changed in this release.',
      whatsNewCount: '{{count}} changes',
    },
  },
  ar: {
    dashboard: {
      todayProgress: 'اليوم',
      getStarted: {
        title: 'ابدأ الآن',
        subtitle: 'خطوات سريعة لتجعل هذا المركز مركزك.',
        progress: 'أنجزت {{done}} من {{total}}',
        dismiss: 'إخفاء',
        stepNote: 'اكتب ملاحظتك الأولى',
        stepNoteHint: 'سجّل فكرة أو شيئاً تريد تذكّره.',
        stepTask: 'أضف مهمة',
        stepTaskHint: 'خطط لما تحتاج إنجازه تالياً.',
        stepProject: 'ابدأ مشروعاً',
        stepProjectHint: 'اجمع الأفكار والمهام المترابطة معاً.',
        stepPalette: 'افتح لوحة الأوامر',
        stepPaletteHint: 'تنقّل أو نفّذ أمراً عبر Ctrl+K.',
      },
    },
    onboarding: {
      eyebrow: 'مرحباً',
      step1: 'اللغة',
      step2: 'المظهر',
      step3: 'الميزات',
      readyTitle: 'كل شيء جاهز',
      readyDesc: 'تم تجهيز مساحتك. لنبدأ!',
      summaryTitle: 'إعدادك',
      paletteHint: 'نصيحة: اضغط Ctrl+K في أي مكان للبحث أو تنفيذ أمر.',
    },
    about: {
      whatsNewBadge: 'إصدار جديد',
      whatsNewHighlights: 'إليك ما تغيّر في هذا الإصدار.',
      whatsNewCount: '{{count}} تغييرات',
    },
  },
} as { en: Record<string, unknown>; ar: Record<string, unknown> }
