import { createClient } from '@insforge/sdk';

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NDc1OTB9.IGk0ERRtr_UyP9ix4wPhx7c_A31-SZq_3pisgdSoHRo';

const insforge = createClient({
  baseUrl: 'https://he7s6aax.ap-southeast.insforge.app',
  anonKey: ANON_KEY,
});

export { insforge };
export default insforge;

export { ANON_KEY };
