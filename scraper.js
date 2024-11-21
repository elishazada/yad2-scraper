const cheerio = require('cheerio');
const Telenode = require('telenode-js');
const fs = require('fs').promises; // Use fs.promises for async operations
const path = require('path');
const config = require('./config.json');

const getYad2Response = async (url) => {
    const requestOptions = {
        method: 'GET',
        redirect: 'follow'
    };
    try {
        const res = await fetch(url, requestOptions);
        return await res.text();
    } catch (err) {
        console.log('Error fetching Yad2 response:', err);
    }
}

const scrapeItemsAndExtractImgUrls = async (url) => {
    const yad2Html = await getYad2Response(url);
    if (!yad2Html) {
        throw new Error("Could not get Yad2 response");
    }
    const $ = cheerio.load(yad2Html);
    const title = $("title");
    const titleText = title.first().text();
    if (titleText === "ShieldSquare Captcha") {
        throw new Error("Bot detection");
    }
    const $feedItems = $(".feeditem").find(".pic");
    if (!$feedItems.length) {
        throw new Error("Could not find feed items");
    }
    const imageUrls = [];
    $feedItems.each((_, elm) => {
        const imgSrc = $(elm).find("img").attr('src');
        if (imgSrc) {
            imageUrls.push(imgSrc);
        }
    });
    return imageUrls;
}

const ensureDataDirectoryExists = async () => {
    const directoryPath = path.resolve(__dirname, 'data');
    try {
        // Create directory if it doesn't exist using promises and recursive option
        await fs.mkdir(directoryPath, { recursive: true });
    } catch (e) {
        console.error('Error ensuring data directory exists:', e);
        throw new Error(`Failed to create or access data directory at ${directoryPath}`);
    }
}

const checkIfHasNewItem = async (imgUrls, topic) => {
    const filePath = path.join(__dirname, 'data', `${topic}.json`);
    let savedUrls = [];

    try {
        // Check if file exists and read content
        const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
        if (fileExists) {
            const fileContent = await fs.readFile(filePath, 'utf8');
            savedUrls = JSON.parse(fileContent);
        } else {
            // Initialize an empty JSON file if it doesn't exist
            await fs.writeFile(filePath, '[]', 'utf8');
        }
    } catch (e) {
        console.error('Error reading or creating file:', e);
        throw new Error(`Could not read / create ${filePath}`);
    }

    let shouldUpdateFile = false;
    const newItems = [];

    // Check new URLs against the saved ones
    imgUrls.forEach(url => {
        if (!savedUrls.includes(url)) {
            savedUrls.push(url);
            newItems.push(url);
            shouldUpdateFile = true;
        }
    });

    // Update the file if there are new items
    if (shouldUpdateFile) {
        const updatedUrls = JSON.stringify(savedUrls, null, 2);
        await fs.writeFile(filePath, updatedUrls, 'utf8');
        await createPushFlagForWorkflow();
    }

    return newItems;
}

const createPushFlagForWorkflow = async () => {
    await fs.writeFile("push_me", "", 'utf8');
}

const scrape = async (topic, url) => {
    const apiToken = process.env.API_TOKEN || config.telegramApiToken;
    const chatId = process.env.CHAT_ID || config.chatId;
    const telenode = new Telenode({ apiToken });

    try {
        await telenode.sendTextMessage(`Starting scanning ${topic} on link:\n${url}`, chatId);
        const scrapeImgResults = await scrapeItemsAndExtractImgUrls(url);
        const newItems = await checkIfHasNewItem(scrapeImgResults, topic);
        if (newItems.length > 0) {
            const newItemsJoined = newItems.join("\n----------\n");
            const msg = `${newItems.length} new items:\n${newItemsJoined}`;
            await telenode.sendTextMessage(msg, chatId);
        } else {
            await telenode.sendTextMessage("No new items were added", chatId);
        }
    } catch (e) {
        let errMsg = e?.message || "";
        if (errMsg) {
            errMsg = `Error: ${errMsg}`;
        }
        await telenode.sendTextMessage(`Scan workflow failed... 😥\n${errMsg}`, chatId);
        throw new Error(`Scan workflow failed: ${errMsg}`);
    }
}

const program = async () => {
    // Ensure 'data' directory exists before starting the program
    await ensureDataDirectoryExists();

    // Process all projects concurrently, ensuring data directory is created once upfront
    await Promise.all(config.projects.filter(project => {
        if (project.disabled) {
            console.log(`Topic "${project.topic}" is disabled. Skipping.`);
            return false;
        }
        return true;
    }).map(async project => {
        await scrape(project.topic, project.url);
    }));
};

program();
