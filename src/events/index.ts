import { RecordingRecover } from "@/interfaces";
import { TickReplayDataMini } from "@/types";
import { Player, defineEvent } from "@infernus/core";
import {
  onIncomingRPC,
  onOutgoingPacket,
  onOutgoingRPC,
} from "@infernus/raknet";

export const [onReplayLoseTick, triggerReplayLoseTick] = defineEvent({
  name: "OnReplayLoseTick",
  isNative: false,
  beforeEach() {
    return {};
  },
});

export const [onReplayTick, triggerReplayTick] = defineEvent({
  name: "OnReplayTick",
  isNative: false,
  beforeEach(replayData: TickReplayDataMini) {
    return {
      tick: replayData[0],
      data: replayData[1],
      additional: replayData[2],
    };
  },
});

export const [onReplayReachEnd, triggerReplayReachEnd] = defineEvent({
  name: "OnReplayReachEnd",
  isNative: false,
  beforeEach() {
    return {};
  },
});

export const [onRecordPlayerDisconnect, triggerRecordPlayerDisconnect] =
  defineEvent({
    name: "OnRecordPlayerDisconnect",
    isNative: false,
    beforeEach(data: RecordingRecover) {
      return data;
    },
  });

export const [onWriteAdditional, triggerWriteAdditional] = defineEvent<{
  player: Player;
  additional: string;
}>({
  name: "OnWriteAdditional",
  isNative: false,
  beforeEach(data) {
    return data;
  },
});

onIncomingRPC(({ next }) => {
  return next();
});

onOutgoingPacket(({ next }) => {
  return next();
});

onOutgoingRPC(({ next }) => {
  return next();
});
