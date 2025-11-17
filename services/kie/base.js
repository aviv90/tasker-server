/**
 * Kie Service Base Class
 */

class KieServiceBase {
  constructor() {
    this.apiKey = process.env.KIE_API_KEY;
    this.baseUrl = 'https://api.kie.ai';
    this.headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
  }
}

module.exports = KieServiceBase;

