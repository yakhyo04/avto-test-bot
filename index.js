require("dotenv").config();
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();

const fs = require('fs');
const path = require('path');

const TOKEN = '7988025268:AAFYj3moTO6u1PQUlI1tYExI7zGZr68v9Sw';
const adminId = '1394184196';
const bot = new TelegramBot(TOKEN, { polling: true });

bot.setMyCommands([
  { command: "/start", description: "Start the bot" },
  { command: "/score", description: "Check your score" },
  { command: "/language", description: "Change language" }
]);

const QUIZ_FILE = 'quizzes.json';
const PROGRESS_FILE = 'progress.json';
const USERS_FILE = 'users.json';

const db = new sqlite3.Database('./quizbot.db');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            chat_id INTEGER PRIMARY KEY,
            first_name TEXT,
            last_name TEXT,
            username TEXT,
            language_code TEXT
        )
    `);
});

const quizzes = JSON.parse(fs.readFileSync(QUIZ_FILE, 'utf8'));
let progress = fs.existsSync(PROGRESS_FILE) ? JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')) : {};
let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) : [];

function saveProgress() {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function getBlock(quizIndex) {
    return Math.floor(quizIndex / 10) + 1;
}

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.chat.first_name;
    const lastName = msg.chat.last_name || '';
    const username = msg.chat.username || '';
    const languageCode = msg.from.language_code;

    storeUserData(chatId, firstName, lastName, username, languageCode);
});

function storeUserData(chatId, firstName, lastName, username, languageCode) {
    const query = `
        INSERT OR REPLACE INTO users (chat_id, first_name, last_name, username, language_code)
        VALUES (?, ?, ?, ?, ?)
    `;

    db.run(query, [chatId, firstName, lastName, username, languageCode], (err) => {
        if (err) {
            console.error('Error inserting/updating user data:', err);
        } else {
            console.log(`User data for chat_id ${chatId} stored/updated successfully.`);
        }
    });
}

bot.onText(/\/data/, (msg) => {
    const chatId = msg.chat.id;
    const query = `SELECT chat_id FROM users`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error retrieving users:', err);
            return bot.sendMessage(chatId, 'Error retrieving users.');
        }

        bot.sendMessage(chatId, `Bot has got ${rows.length} users!`);
    });
});

bot.onText(/\/users/, (msg) => {
    const chatId = msg.chat.id;

    if (chatId != adminId) {
        return bot.sendMessage(chatId, 'You are not authorized to use this command.');
    }

    const query = `SELECT * FROM users`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error retrieving users:', err);
            return bot.sendMessage(chatId, 'Error retrieving users.');
        }

        if (rows.length === 0) {
            return bot.sendMessage(chatId, 'No users found.');
        }

        let userList = 'List of all users:\n\n';
        rows.forEach((row, index) => {
            userList += `User ${index + 1}:\n`;
            userList += `Chat ID: ${row.chat_id}\n`;
            userList += `Name: ${row.first_name} ${row.last_name}\n`;
            userList += `Username: ${row.username}\n`;
            userList += `Language: ${row.language_code}\n\n`;
        });

        bot.sendMessage(chatId, userList);
    });
});

bot.on('polling_error', (error) => {
    console.error(error);
});

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (!users.includes(chatId)) {
        users.push(chatId);
        saveUsers();
    }

    bot.sendMessage(chatId, 'Tilni tanlang / Выберите язык:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🇺🇿 Oʻzbekcha', callback_data: 'lang_uz' }],
                [{ text: '🇷🇺 Русский', callback_data: 'lang_ru' }]
            ]
        }
    });
});

bot.onText(/\/language/, (msg) => {
    const chatId = msg.chat.id;

    if (!progress[chatId]) {
        return bot.sendMessage(chatId, 'You need to start the quiz first. Use /start.');
    }

    bot.sendMessage(chatId, 'Tilni tanlang / Выберите язык', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🇺🇿 Oʻzbekcha', callback_data: 'lang_uz' }],
                [{ text: '🇷🇺 Русский', callback_data: 'lang_ru' }]
            ]
        }
    });
});

bot.onText(/\/send_to_all (.+)/, (msg, match) => {
    const chatId = msg.chat.id;

    if (chatId != adminId) {
        return bot.sendMessage(chatId, 'You are not authorized to use this command.');
    }

    const message = match[1];

    const query = `SELECT chat_id FROM users`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error retrieving users:', err);
            return bot.sendMessage(chatId, 'Error retrieving users.');
        }

        if (rows.length === 0) {
            return bot.sendMessage(chatId, 'No users found.');
        }

        rows.forEach(row => {
            bot.sendMessage(row.chat_id, message)
                .catch(error => {
                    console.error(`Error sending message to ${row.chat_id}:`, error);
                });
        });

        bot.sendMessage(chatId, `Message sent to ${rows.length} users!`);
    });
});

bot.on('callback_query', (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    let data = callbackQuery.data;

    if (data.startsWith('lang_')) {
        let language = data.split('_')[1];

        if (language === 'uz_kiril') {
            language = 'uz_cyrillic';
        }

        if (!progress[chatId]) {
            progress[chatId] = {};
        }

        progress[chatId].language = language;
        progress[chatId].quiz = 0;
        progress[chatId].score = 0;

        saveProgress();
        if (language === 'uz') {
            bot.sendMessage(chatId, 'Til o‘zgartirildi: 🇺🇿 Oʻzbekcha');
        } else if (language === 'ru') {
            bot.sendMessage(chatId, 'Язык изменен: 🇷🇺 Русский');
        }
        showBlocks(chatId);
    } else if (data.startsWith('block_')) {
        const block = parseInt(data.split('_')[1]);
        progress[chatId].quiz = (block - 1) * 10;
        saveProgress();
        sendQuiz(chatId);
    } else if (data.startsWith('answer_')) {
        const answerIndex = parseInt(data.split('_')[1]);
        let { quiz, score, language } = progress[chatId];
        const currentQuiz = quizzes[quiz];

        const selectedAnswerText = currentQuiz.answers[answerIndex].text[language] || currentQuiz.answers[answerIndex].text['uz'];

        const isCorrect = currentQuiz.answers[answerIndex].isCorrect;
        let response;

        if (isCorrect) {
            progress[chatId].score++;
            response = `✅ ${(language === 'uz' ? 'To‘g‘ri!' : language === 'ru' ? 'Правильно!' : 'Тўғри!')}`;
        } else {
            const correctAnswer = currentQuiz.answers.find(answer => answer.isCorrect);
            const correctAnswerText = correctAnswer.text[language] || correctAnswer.text['uz'];
            response = `❌ ${(language === 'uz' ? 'Noto‘g‘ri!' : language === 'ru' ? 'Неправильно!' : 'Нотўғри!')} ${language === 'uz' ? 'To‘g‘ri javob:' : language === 'ru' ? 'Правильный ответ:' : 'Тўғри жавоб:'} ${correctAnswerText}`;
        }

        bot.sendMessage(chatId, `${response} ${language === 'uz' ? 'Siz tanlagan javob: ' : language === 'ru' ? 'Ваш ответ: ' : 'Сизнинг жавобингиз: '} ${selectedAnswerText}`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: language === 'uz' ? 'Keyingi savol' : language === 'ru' ? 'Следующий вопрос' : 'Кейинги савол', callback_data: 'next_quiz' }],
                    [{ text: language === 'uz' ? 'Biletlar' : language === 'ru' ? 'Билеты' : 'Билетлар', callback_data: 'blocks_page' }]
                ]
            }
        });

        saveProgress();
    } else if (data === 'next_quiz') {
        progress[chatId].quiz++;
        let { quiz } = progress[chatId];
        if (quiz >= quizzes.length) {
            bot.sendMessage(chatId, 'You have completed the quiz!', {
                reply_markup: { inline_keyboard: [[{ text: 'Restart Quiz', callback_data: 'restart_quiz' }]] }
            });
        } else {
            sendQuiz(chatId);
        }
        saveProgress();
    } else if (data === 'blocks_page') {
        showBlocks(chatId);
    } else if (data === 'help_quiz') {
        let { quiz, language } = progress[chatId];
        const currentQuiz = quizzes[quiz];
        bot.sendMessage(chatId, currentQuiz.description[language]);
    } else if (data.startsWith('page_')) {
        const page = parseInt(data.split('_')[1]);
        showBlocks(chatId, page);
    }
});

function sendQuiz(chatId) {
    let { quiz, language } = progress[chatId];
    if (quiz >= quizzes.length) return bot.sendMessage(chatId, 'No more questions available.');

    const currentQuiz = quizzes[quiz];
    const questionText = currentQuiz.question[language] || currentQuiz.question['uz'];

    const biletText = language === 'uz' 
        ? `📚 ${getBlock(quiz)}-bilet, ${currentQuiz.id}-savol`
        : language === 'ru' 
        ? `📚 ${getBlock(quiz)}-билет, ${currentQuiz.id}-вопрос`
        : `📚 ${getBlock(quiz)}-bilet, ${currentQuiz.id}-savol`;

    const fullQuestionText = `${biletText}\n\n${questionText}`;

    if (currentQuiz.hasMedia) {
        const imagePath = path.join(__dirname, 'images', `image_${quiz + 1}.png`);
        if (fs.existsSync(imagePath)) {
            bot.sendPhoto(chatId, imagePath, { contentType: 'image/png' }).then(() => {
                sendPoll(chatId, currentQuiz, language, fullQuestionText);
            });
        } else {
            bot.sendMessage(chatId, 'Sorry, the media for this question is not available.').then(() => {
                sendPoll(chatId, currentQuiz, language, fullQuestionText);
            });
        }
    } else {
        sendPoll(chatId, currentQuiz, language, fullQuestionText);
    }
}

function sendPoll(chatId, currentQuiz, language, fullQuestionText) {
    const options = currentQuiz.answers.map((option) => 
        (option.text[language] || option.text['uz']).slice(0, 100)
    );

    bot.sendPoll(chatId, fullQuestionText || (currentQuiz.question[language] || currentQuiz.question['uz']), options, {
        type: 'quiz',
        correct_option_id: currentQuiz.answers.findIndex(answer => answer.isCorrect),
        is_anonymous: false
    }).then((poll) => {
        progress[chatId].lastPollId = poll.poll.id;
        saveProgress();
    });
}

bot.on('poll_answer', (pollAnswer) => {
    const chatId = pollAnswer.user.id;
    const answerIndex = pollAnswer.option_ids[0];

    if (!progress[chatId]) return;

    let { quiz, language } = progress[chatId];
    const currentQuiz = quizzes[quiz];

    const isCorrect = currentQuiz.answers[answerIndex]?.isCorrect;
    let response;

    if (isCorrect) {
        progress[chatId].score++;
    }

    if (response) {
        bot.sendMessage(chatId, response);
    }

    progress[chatId].quiz++;
    saveProgress();

    if (progress[chatId].quiz >= quizzes.length) {
        bot.sendMessage(chatId, 'You have completed the quiz!', {
            reply_markup: { inline_keyboard: [[{ text: 'Restart Quiz', callback_data: 'restart_quiz' }]] }
        });
    } else {
        sendQuiz(chatId);
    }
});

function showBlocks(chatId, page = 1) {
    const { language } = progress[chatId];
    const totalBlocks = Math.ceil(quizzes.length / 10);
    const blocksPerPage = 10;
    const startBlock = (page - 1) * blocksPerPage;
    const endBlock = Math.min(page * blocksPerPage, totalBlocks);

    let buttons = [];
    for (let i = startBlock + 1; i <= endBlock; i++) {
        const biletText1 = language === 'uz' ? `${i}-bilet` : language === 'ru' ? `${i}-билет` : `${i}-bilet`;
        const biletText2 = language === 'uz' ? `${i + 1}-bilet` : language === 'ru' ? `${i + 1}-билет` : `${i + 1}-bilet`;
    
        buttons.push([
            { text: biletText1, callback_data: `block_${i}` },
            { text: biletText2, callback_data: `block_${i + 1}` }
        ]);
    
        i++;
    }

    const pagination = [];
    if (page > 1) {
        pagination.push({ text: language === 'uz' ? 'Oldingi' : language === 'ru' ? 'Предыдущий' : 'Oldingi', callback_data: `page_${page - 1}` });
    }
    if (page < totalBlocks && endBlock < totalBlocks) {
        pagination.push({ text: language === 'uz' ? 'Keyingi' : language === 'ru' ? 'Следующий' : 'Keyingi', callback_data: `page_${page + 1}` });
    }

    bot.sendMessage(chatId, language === 'uz' ? 'Biletni tanlang:' : language === 'ru' ? 'Выберите билет:' : 'Билетни танланг:', {
        reply_markup: {
            keyboard: [
                ...buttons,
                pagination
            ],
            one_time_keyboard: true,
            resize_keyboard: true
        }
    });
}

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!progress[chatId]) return;

    const { language } = progress[chatId];

    if (text.includes('-bilet') || text.includes('-билет')) {
        const selectedBlock = parseInt(text.split('-')[0]);

        if (!isNaN(selectedBlock)) {
            progress[chatId].quiz = (selectedBlock - 1) * 10;
            sendQuiz(chatId);
        }
    }

    if (text === (language === 'uz' ? 'Oldingi' : language === 'ru' ? 'Предыдущий' : 'Oldingi')) {
        progress[chatId].page = Math.max((progress[chatId].page || 1) - 1, 1);
        showBlocks(chatId, progress[chatId].page);
    }

    if (text === (language === 'uz' ? 'Keyingi' : language === 'ru' ? 'Следующий' : 'Keyingi')) {
        progress[chatId].page = (progress[chatId].page || 1) + 1;
        showBlocks(chatId, progress[chatId].page);
    }
});

bot.onText(/\/score/, (msg) => {
    const chatId = msg.chat.id;
    if (!progress[chatId]) return bot.sendMessage(chatId, 'You have not started the quiz yet.');

    const { score, quiz, language } = progress[chatId];
    const totalQuestions = quiz;
    const totalCorrect = score;
    const totalIncorrect = totalQuestions - totalCorrect;

    bot.sendMessage(chatId, `${language === 'uz' ? 'Sizning ballaringiz:' : language === 'ru' ? 'Ваши баллы:' : 'Сизнинг балларингиз:'} ${score}\n${language === 'uz' ? 'To‘g‘ri javoblar: ' : language === 'ru' ? 'Правильные ответы: ' : 'Тўғри жавоблар: '}${totalCorrect}\n${language === 'uz' ? 'Noto‘g‘ri javoblar: ' : language === 'ru' ? 'Неправильные ответы: ' : 'Нотўғри жавоблар: '}${totalIncorrect}`);
});