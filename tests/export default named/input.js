export default async function fetch() {
    try {
        if (true) {
            if ('application/json') {
                data = await res.json()
            } else {
                try {
                text = await res.text()
                } catch (berr) {
                console.error(berr)
                }
            }
        } else if (res.status === 204) {
            data = null
        } else {
            data = await res.json()
        }
    } catch (e) {
        console.log(er)
    }
}
