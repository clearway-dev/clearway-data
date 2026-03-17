import { MeasurementData } from '../components/DataDisplay';

// Expo exposes EXPO_PUBLIC_* vars to app runtime.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api-mobile.clearway.zephyron.tech';
const MEASUREMENTS_ENDPOINT = '/api/v1/measurements';

export interface ApiResponse {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Sends measurement data to the FastAPI backend
 * @param data - Measurement data to send
 * @returns Promise with API response
 */
export const sendMeasurementData = async (
  data: MeasurementData
): Promise<ApiResponse> => {
  try {
    const response = await fetch(`${API_BASE_URL}${MEASUREMENTS_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    return {
      success: true,
      message: 'Data úspěšně odeslána',
    };
  } catch (error) {
    console.error('Error sending measurement data:', error);
    
    return {
      success: false,
      message: 'Chyba při odesílání dat',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};
