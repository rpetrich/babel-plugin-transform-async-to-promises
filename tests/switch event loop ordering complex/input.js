Promise.all([test('case1'), test('case2'), test('case3')]);
function wait(messages) {
    messages.push('waitStart');

    return new Promise((resolve, reject) => setTimeout(resolve, 0))
        .then(() => {
            messages.push('waitStop');
        });
}

async function test(v) {
    let messages = [];

    switch (v) {
        case 'case1':
            messages.push('case1Start');
            await wait(messages);
            messages.push('case1Stop');
            break;
        case 'case2':
            messages.push('case2Start');
            await wait(messages);
            messages.push('case2Stop');
            // through
        case 'case3':
            messages.push('case3Start');
            await wait(messages);
            messages.push('case3Stop');
            break;
    }

    return messages;
}