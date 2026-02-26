type ModalId = string;

interface ModalRegistration {
  id: ModalId;
  close: () => void;
  canStackWith?: ModalId[];
  allowStackOnMobile?: boolean;
}

class ModalManager {
  private readonly registry = new Map<ModalId, ModalRegistration>();
  private readonly visible = new Set<ModalId>();

  register(config: ModalRegistration): void {
    this.registry.set(config.id, {
      ...config,
      canStackWith: Array.isArray(config.canStackWith) ? [...config.canStackWith] : [],
      allowStackOnMobile: config.allowStackOnMobile === true,
    });
  }

  requestOpen(id: ModalId): void {
    const incoming = this.registry.get(id);
    if (!incoming) {
      return;
    }

    const currentlyVisible = [...this.visible].filter((openId) => openId !== id);
    currentlyVisible.forEach((openId) => {
      const active = this.registry.get(openId);
      if (!active) {
        this.visible.delete(openId);
        return;
      }

      if (this.canStack(incoming, active)) {
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

  private canStack(incoming: ModalRegistration, active: ModalRegistration): boolean {
    const incomingAllowed = (incoming.canStackWith ?? []).includes(active.id);
    const activeAllowed = (active.canStackWith ?? []).includes(incoming.id);
    if (!incomingAllowed || !activeAllowed) {
      return false;
    }

    if (this.isDesktopViewport()) {
      return true;
    }

    return incoming.allowStackOnMobile === true && active.allowStackOnMobile === true;
  }

  private isDesktopViewport(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return true;
    }
    return window.matchMedia("(min-width: 1024px)").matches;
  }
}

export const modalManager = new ModalManager();
