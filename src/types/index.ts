import { TickReplayData } from "@/interfaces";
import { IInCarSync } from "@infernus/raknet";

export type TickReplayDataMini = [
  TickReplayData["tick"],
  (
    | [
        IInCarSync["lrKey"],
        IInCarSync["udKey"],
        IInCarSync["keys"],
        IInCarSync["quaternion"],
        IInCarSync["position"],
        IInCarSync["velocity"],
        IInCarSync["vehicleHealth"],
        IInCarSync["additionalKey"],
        IInCarSync["weaponId"],
        IInCarSync["sirenState"],
        IInCarSync["landingGearState"],
        IInCarSync["trainSpeed"]
      ]
    | null
  ),
  unknown?
];