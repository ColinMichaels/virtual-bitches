type ModalId = string;

interface ModalRegistration {
  id: ModalId;
  close: () => void;
  canStackWith?: ModalId[];
  allowStackOnMobile?: boolean;
}

interface ModalOpenOptions {
  preserveOpenIds?: ModalId[];
}

class ModalManager {
  private readonly registry = new Map<ModalId, ModalRegistration>();
  private readonly visible = new Set<ModalId>();

  register(config: ModalRegistration): void {
    this.registry.set(config.id, config);
  }

  requestOpen(id: ModalId, options?: ModalOpenOptions): void {
    if (!this.registry.has(id)) {
      return;
    }

    // Single-modal behavior: opening any modal closes all others first.
    const preservedOpenIds = new Set(options?.preserveOpenIds ?? []);
    const currentlyVisible = [...this.visible].filter(
      (openId) => openId !== id && !preservedOpenIds.has(openId)
    );
    currentlyVisible.forEach((openId) => {
      const active = this.registry.get(openId);
      if (!active) {
        this.visible.delete(openId);
        return;
      }

      active.close();
      this.visible.delete(openId);
    });

    this.visible.add(id);
  }

  notifyClosed(id: ModalId): void {
    this.visible.delete(id);
  }
}

export const modalManager = new ModalManager();
