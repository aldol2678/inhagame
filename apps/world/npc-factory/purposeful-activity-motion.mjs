const energyOf = value => Number.isFinite(value) ? Math.min(1.4, Math.max(0.6, value)) : 1;
const pose = (armPitch, {
  armYaw = [0, 0], armRoll = [0, 0], legPitch = [0, 0]
} = {}) => ({ armPitch, armYaw, armRoll, legPitch });

export function purposefulActivityPose(activity, {
  phase = 0,
  motionEnergy = 1,
  sitting = false
} = {}) {
  const energy = energyOf(motionEnergy);
  const wave = Math.sin(phase);
  const slowWave = Math.sin(phase * 0.45);

  if (sitting || activity === 'RESTING') {
    return pose([-12, -12], { legPitch: sitting ? [-40, -40] : [0, 0] });
  }

  switch (activity) {
    case 'READING':
      return pose([-18, -18], { armRoll: [-5, 5] });
    case 'COFFEE':
    case 'EATING':
      return pose([
        -24 + slowWave * 6 * energy,
        -20 - slowWave * 3 * energy
      ], { armRoll: [-4, 3] });
    case 'PHOTO':
      return pose([
        -50 + slowWave * 4 * energy,
        -46 - slowWave * 3 * energy
      ], { armYaw: [-5, 5], armRoll: [-8, 8] });
    case 'PHONE':
      return pose([
        -38 + slowWave * 3 * energy,
        -14 - slowWave * 2 * energy
      ], { armRoll: [-5, 2] });
    case 'MUSIC':
      return pose([
        wave * 7 * energy,
        -wave * 7 * energy
      ], { armRoll: [3 * slowWave * energy, -3 * slowWave * energy] });
    case 'WALK_BREAK':
      return pose([
        wave * 4 * energy,
        -wave * 4 * energy
      ]);
    case 'WAITING':
    case 'TRANSIT':
    case 'CLUB':
    case 'ACADEMIC':
      return pose([
        slowWave * 2.5 * energy,
        -slowWave * 2.5 * energy
      ]);
    default:
      return pose([
        slowWave * 1.5 * energy,
        -slowWave * 1.5 * energy
      ]);
  }
}
