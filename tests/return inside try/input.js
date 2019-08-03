async function(wait, messages) {
    messages.push('before-try');
    try {
        messages.push('start-try');
        await wait(1);
        messages.push('stop-try');

        return 'result-try';
    } catch (e) {
        messages.push('catch');
    }
    messages.push('after-try');

    return 'result-after-try';
}
