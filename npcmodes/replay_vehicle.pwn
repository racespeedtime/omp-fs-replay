#include <a_npc>
main(){}
NextPlayback()
{
	StartRecordingPlayback(PLAYER_RECORDING_TYPE_DRIVER, "replay_vehicle");
}
public OnRecordingPlaybackEnd()
{
    NextPlayback();
}
public OnNPCEnterVehicle(vehicleid, seatid)
{
    NextPlayback();
}
public OnNPCExitVehicle()
{
	StopRecordingPlayback();
}