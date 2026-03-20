/**
 * 共享动画配置
 * Framer Motion variants 和 transition presets
 * 基于 OPENCLAW_WHITE_THEME_DESIGN.md 设计规范
 */

/** 缓动曲线常量 */
const EASE_OUT = [0.4, 0, 0.2, 1] as const;
const SPRING = { type: "spring" as const, stiffness: 500, damping: 30 };

/** 页面切换过渡 */
export const pageTransition = {
  initial: { opacity: 0, x: 8 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -8 },
  transition: { duration: 0.2, ease: EASE_OUT },
};

/** 淡入上移动画 (默认) - 200ms */
export const fadeInUp = (delay = 0) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.2, ease: EASE_OUT },
});

/** 淡入动画 - 150ms */
export const fadeIn = (delay = 0) => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { delay, duration: 0.15, ease: EASE_OUT },
});

/** 缩放淡入 - 200ms */
export const scaleIn = (delay = 0) => ({
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  transition: { delay, duration: 0.2, ease: EASE_OUT },
});

/** 渐入（从上方） */
export const fadeInDown = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, ease: EASE_OUT },
};

/** 弹簧缩放（用于选中状态） */
export const springScale = {
  initial: { scale: 0 },
  animate: { scale: 1 },
  transition: SPRING,
};

/** 交错子项入场 - 50ms 间隔 */
export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
};

export const staggerItem = {
  initial: { opacity: 0, y: 12 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: EASE_OUT },
  },
};

/** 交错入场 - 100ms 间隔 */
export const staggerChild = (i: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.25, ease: EASE_OUT },
  },
});

/** 按钮点击缩放 - 100ms */
export const buttonPress = {
  whileTap: { scale: 0.98 },
  transition: { duration: 0.1 },
};

/** 卡片悬停 - 250ms */
export const cardHover = {
  whileHover: {
    y: -2,
    boxShadow: '0 8px 24px rgba(30, 25, 24, 0.08)',
    borderColor: 'rgba(37, 99, 235, 0.3)',
  },
  transition: { duration: 0.25 },
};

/** 焦点动画 */
export const focusRing = {
  whileFocus: {
    boxShadow: '0 0 0 4px rgba(37, 99, 235, 0.1)',
  },
};