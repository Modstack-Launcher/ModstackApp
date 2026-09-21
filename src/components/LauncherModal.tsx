import type { ReactNode } from "react";
import { Modal } from "@heroui/react";

export default function LauncherModal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  return <Modal.Backdrop isOpen={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <Modal.Container><Modal.Dialog className="w-full max-w-lg rounded-[28px] border border-white/10 bg-surface p-7 shadow-2xl">
      <Modal.CloseTrigger />
      <Modal.Header><Modal.Heading className="text-xl font-bold">{title}</Modal.Heading></Modal.Header>
      <Modal.Body className="flex flex-col gap-4 pt-3">{children}</Modal.Body>
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop>;
}
