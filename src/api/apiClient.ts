import axios from 'axios';

const apiClient = axios.create({
  baseURL: 'https://api.thinkcoffee.com',
  headers: {
    'Content-Type': 'application/json',
  },
});

export const fetchMenu = async () => {
  const response = await apiClient.get('/menu');
  return response.data;
};

export default apiClient;