import axios from "axios"

const axiosClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
    withCredentials: true,
    timeout: 15000,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Response interceptor — convert raw network errors into readable messages
axiosClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (!error.response) {
            // No response at all = server is down or unreachable
            error.message = 'Cannot reach the server. Please make sure the backend is running on port 3000.';
        }
        return Promise.reject(error);
    }
);

export default axiosClient;