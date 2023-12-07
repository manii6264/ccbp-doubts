const express = require('express')
const path = require('path')

const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')
let db = null

const dbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })

    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

dbAndServer()

const validatePassword = password => {
  return password.length > 6
}

// 1 Register

app.post('/register/', async (request, response) => {
  const {username, name, password, gender} = request.body
  const hashedPassword = await bcrypt.hash(password, 10)
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    const createUserQuery = `INSERT INTO user (username, password, name, gender)
     VALUES ('${username}', '${hashedPassword}', '${name}', '${gender}');`
    if (validatePassword(password)) {
      await db.run(createUserQuery)
      response.send('User created successfully')
    } else {
      response.status(400)
      response.send('Password is too short')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

// 2 Login

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {username: username}
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

// 3

const authenticateUser = (request, response, next) => {
  const token = request.headers['authorization']
  if (!token) {
    return response.status(401).json({error: 'Invalid JWT Token'})
  }
  try {
    const decoded = jwt.verify(token, 'your_secret_key')
    request.userId = decoded.userId
    next()
  } catch (error) {
    return response.status(401).send('Invalid JWT Token')
  }
}

app.get('/user/tweets/feed/', authenticateUser, async (request, response) => {
  const userId = request.userId
  const tweets = await db.all(
    `SELECT tweet.tweet_id, tweet.tweet, tweet.date_time, user.username
      FROM tweet
      JOIN user ON tweet.user_id = user.user_id
      JOIN follower ON user.user_id = follower.following_user_id
      WHERE follower.follower_user_id = ${userId}
      ORDER BY tweet.date_time DESC
      LIMIT 4;`,
  )

  response.send(tweets)
})

// 4.Following

app.get('/user/following/', authenticateUser, async (request, response) => {
  const userId = request.userId
  const followingList = await db.all(`SELECT User.name FROM User
      JOIN Follower ON User.user_id = Follower.following_user_id
      WHERE Follower.follower_user_id = ${userId};`)
  response.send({following: followingList.map(user => user.name)})
})

// 5.Followers

app.get('/user/followers/', authenticateUser, async (request, response) => {
  const userId = request.userId
  const followersList = await db.all(`SELECT User.name FROM User
      JOIN Follower ON User.user_id = Follower.follower_user_id
      WHERE Follower.following_user_id = ${userId};`)
  response.json({followers: followersList.map(user => user.name)})
})

// 6

app.get('/user/followers/', authenticateUser, async (request, response) => {
  const userId = request.userId
  const followersList = await db.all(`SELECT user.name FROM User
      JOIN follower ON user.user_id = follower.follower_user_id
      WHERE follower.following_user_id = ${userId};`)
  response.send({followers: followersList.map(user => user.name)})
})

// 7

const checkFollowing = async (request, response, next) => {
  const userId = request.userId
  const tweetId = parseInt(request.params.tweetId)
  const isFollowing = await db.get(`SELECT 1 FROM tweet
      JOIN User ON Tweet.user_id = User.user_id
      JOIN Follower ON User.user_id = Follower.following_user_id
      WHERE Tweet.tweet_id = ${tweetId} AND Follower.follower_user_id = ${userId};`)

  if (isFollowing) {
    next()
  } else {
    response.status(401).send('Invalid Request')
  }
}

app.get(
  '/tweets/:tweetId/likes/',
  authenticateUser,
  checkFollowing,
  async (request, response) => {
    try {
      const userId = request.userId
      const tweetId = parseInt(request.params.tweetId)
      const isFollowing = await db.get(`SELECT 1 FROM Tweet
      JOIN User ON Tweet.user_id = User.user_id
      JOIN Follower ON User.user_id = Follower.following_user_id
      WHERE Tweet.tweet_id = ${tweetId} AND Follower.follower_user_id = ${userId};`)
      if (!isFollowing) {
        return response.status(401).send({error: 'Invalid Request'})
      }
      const likesList = await db.all(`SELECT User.username FROM like
      JOIN User ON Like.user_id = User.user_id
      WHERE Like.tweet_id = ${tweetId};`)
      response.send(likesList.map(user => user.username))
    } catch (error) {
      response.status(401).send('Invalid Request')
    }
  },
)

// 8

app.get(
  '/tweets/:tweetId/replies/',
  authenticateUser,
  checkFollowing,
  async (request, response) => {
    const tweetId = parseInt(request.params.tweetId)
    const repliesList =
      await db.all(`SELECT reply.reply, user.username, reply.date_time
      FROM reply
      JOIN user ON reply.user_id = user.user_id
      WHERE reply.tweet_id = ${tweetId};`)
    response.send(repliesList)
  },
)

// 9

app.get('/user/tweets/', authenticateUser, async (request, response) => {
  const userId = request.userId
  const tweetsList = await db.all(
    `SELECT tweet_id, tweet, date_time FROM tweet WHERE user_id = ${userId};`,
  )
  response.send(tweetsList)
})

// 10

app.post('/user/tweets/', authenticateUser, async (request, response) => {
  const {tweet} = request.body

  if (!tweet || typeof tweet !== 'string') {
    response.status(400).send('Invalid tweet content')
    return
  }
  await db.run(
    `
      INSERT INTO Tweet (tweet)
      VALUES (${tweet});
    `,
  )

  response.send('Created a Tweet')
})

// 11

app.delete('/tweets/:tweetId/', authenticateUser, async (request, response) => {
  const userId = request.userId
  const tweetId = parseInt(request.params.tweetId)
  const isTweetOwner = await db.get(` SELECT 1 FROM Tweet
      WHERE tweet_id = ${tweetId} AND user_id = ${userId};`)
  if (!isTweetOwner) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    await db.run(`DELETE FROM tweet WHERE tweet_id = ${tweetId};`)
    response.send('Tweet Removed')
  }
})

module.exports = app
