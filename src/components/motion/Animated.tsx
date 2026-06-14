import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Standard fade+scale backdrop for modal overlays.
 * Use inside <AnimatePresence> at the call site.
 */
export function ModalBackdrop({
  className,
  onClick,
  onMouseDown,
  children,
}: {
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={className}
      onClick={onClick}
      onMouseDown={onMouseDown}
    >
      {children}
    </motion.div>
  );
}

/**
 * Standard scale+slide-in content panel for modals.
 * Use inside <AnimatePresence> at the call site, nested in ModalBackdrop.
 */
export function ModalPanel({
  className,
  style,
  onClick,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 12 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className={className}
      style={style}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}

/** Row/list item fade+slide entrance, intended for use inside AnimatePresence. */
export function AnimatedListItem({
  className,
  style,
  layoutId,
  onClick,
  children,
  delay = 0,
}: {
  className?: string;
  style?: React.CSSProperties;
  layoutId?: string;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      layoutId={layoutId}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.2, delay, ease: "easeOut" }}
      className={className}
      style={style}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}

/** Card hover lift effect wrapper. */
export function HoverCard({
  className,
  style,
  onClick,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={className}
      style={style}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}
