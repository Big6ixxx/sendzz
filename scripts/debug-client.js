const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
require('dotenv').config({ path: '.env.local' });

const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.ENTITY_SECRET,
});

console.log("------------ AVAILABLE METHODS ------------");
// We need to see the functions attached to the client
console.log(Object.keys(client));
// Also check the prototype just in case
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(client)));
console.log("-------------------------------------------");