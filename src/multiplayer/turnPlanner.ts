export interface MultiplayerTurnParticipant {
  playerId: string;
  displayName: string;
  seatIndex: number;
  isBot: boolean;
}

export interface MultiplayerTurnPlan {
  order: MultiplayerTurnParticipant[];
  activeIndex: number;
  round: number;
}

export function buildClockwiseTurnPlan(
  participants: MultiplayerTurnParticipant[],
  currentPlayerSeat: number
): MultiplayerTurnPlan {
  const order = [...participants].sort((left, right) => {
    const leftDistance = clockwiseSeatDistance(currentPlayerSeat, left.seatIndex);
    const rightDistance = clockwiseSeatDistance(currentPlayerSeat, right.seatIndex);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    return left.playerId.localeCompare(right.playerId);
  });

  return {
    order,
    activeIndex: 0,
    round: 1,
  };
}

export function advanceClockwiseTurn(
  plan: MultiplayerTurnPlan
): MultiplayerTurnPlan {
  if (plan.order.length === 0) {
    return plan;
  }

  const nextIndex = (plan.activeIndex + 1) % plan.order.length;
  return {
    ...plan,
    activeIndex: nextIndex,
    round: plan.round + (nextIndex === 0 ? 1 : 0),
  };
}

function clockwiseSeatDistance(fromSeat: number, toSeat: number): number {
  return ((toSeat - fromSeat) % 8 + 8) % 8;
}
