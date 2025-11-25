/**
 * Kie Service Base Class
 */

export class KieServiceBase {
  apiKey: string | undefined;
  baseUrl: string;
  headers: {
    'Authorization': string;
    'Content-Type': string;
  };

  constructor() {
    this.apiKey = process.env.KIE_API_KEY;
    this.baseUrl = 'https://api.kie.ai';
    this.headers = {
      'Authorization': `Bearer ${this.apiKey || ''}`,
      'Content-Type': 'application/json'
    };
  }
}

