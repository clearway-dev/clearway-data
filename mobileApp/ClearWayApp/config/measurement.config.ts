/**
 * Measurement Simulation Configuration
 * 
 * Configuration for sensor simulation and measurement parameters
 */

export const MeasurementConfig = {
  /**
   * Normal distance range for left sensor (in cm)
   */
  NORMAL_DISTANCE_MIN: 290,
  NORMAL_DISTANCE_MAX: 310,

  /**
   * Obstacle distance range (in cm) - representing parked car
   */
  OBSTACLE_DISTANCE_MIN: 190,
  OBSTACLE_DISTANCE_MAX: 230,

  /**
   * Outlier (noise) distance ranges (in cm)
   */
  OUTLIER_LOW_MIN: 45,
  OUTLIER_LOW_MAX: 95,
  OUTLIER_HIGH_MIN: 550,
  OUTLIER_HIGH_MAX: 600,

  /**
   * Probability of Type A anomaly (single outlier/sensor noise)
   * @default 0.05 (5%)
   */
  ANOMALY_TYPE_A_PROBABILITY: 0.05,

  /**
   * Probability of Type B anomaly (real obstacle)
   * @default 0.03 (3%)
   */
  ANOMALY_TYPE_B_PROBABILITY: 0.03,

  /**
   * Duration of Type B obstacle (number of measurements)
   */
  OBSTACLE_DURATION_MIN: 3,
  OBSTACLE_DURATION_MAX: 5,

  /**
   * Vehicle configuration
   */
  vehicle: {
    /**
     * Default vehicle width in cm (fallback when not available from API)
     * @default 180 cm
     */
    defaultWidthCm: 180,
  },

  /**
   * Street width thresholds for color coding
   */
  widthThresholds: {
    greenMinMeters: 3.5,  // > 3.5m = Green
    yellowMinMeters: 3.0, // 3.0-3.5m = Yellow
    // < 3.0m = Red
    colors: {
      green: '#22c55e',
      yellow: '#eab308',
      red: '#ef4444',
    },
  },
} as const;
