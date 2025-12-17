
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log("=== Project Expiration Tool ===");
console.log("Use this tool to set the license expiration date for the project.");
console.log("Format: YYYY-MM-DD (e.g., 2024-06-01)");

rl.question('Enter Expiration Date: ', (date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        console.error("Invalid format! Use YYYY-MM-DD.");
        rl.close();
        return;
    }

    const serverPath = path.join(__dirname, 'server.js');
    if (!fs.existsSync(serverPath)) {
        console.error("server.js not found!");
        rl.close();
        return;
    }

    let content = fs.readFileSync(serverPath, 'utf8');
    
    // Regex to find: const EXPIRY_DATE = "..."
    const regex = /const EXPIRY_DATE = ".*?";/;
    
    if (regex.test(content)) {
        const newContent = content.replace(regex, `const EXPIRY_DATE = "${date}";`);
        fs.writeFileSync(serverPath, newContent, 'utf8');
        console.log(`\nSUCCESS! Expiration date set to: ${date}`);
        console.log("Please restart the server for changes to take effect.");
    } else {
        console.error("Could not find the EXPIRY_DATE variable in server.js.");
    }

    rl.close();
});
