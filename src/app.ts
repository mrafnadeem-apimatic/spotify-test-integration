import readline from 'readline';
import dotenv from 'dotenv';
import {
  ApiError,
  ArtistsController,
  Client,
  Environment,
  ItemTypeEnum,
  OAuthProviderError,
  OAuthScopeEnum,
  PlaylistsController,
  SearchController,
  UsersController,
} from 'spotify-api-sdk';
import http from 'http';

dotenv.config();

// TODO: Replace with your actual Spotify OAuth credentials
const clientId = process.env.SPOTIFY_CLIENT_ID || '';
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || '';
const redirectUri = process.env.SPOTIFY_REDIRECT_URI || '';

// Helper to prompt user input
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer);
    })
  );
}

async function getSpotifyAuthCode(authUrl: string, redirectUri: string): Promise<string> {
  // Open the user's browser automatically for convenience
  const open = await import('open');
  open.default(authUrl);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Use the full URL from the request headers
      const fullUrl = `http://${req.headers.host}${req.url}`;
      const url = new URL(fullUrl);
      const code = url.searchParams.get('code');
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization successful! You can close this window.</h1>');
        server.close();
        resolve(code);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>No code found in the callback.</h1>');
        server.close();
        reject(new Error('No code found in callback'));
      }
    });
    const port = Number(new URL(redirectUri).port) || 4000;
    server.listen(port, () => {
      console.log(`Listening for Spotify redirect on ${redirectUri}`);
    });
  });
}

async function initializeSpotifyClientWithOAuth() {
  // Initialize the Spotify API client
  const config = {
    authorizationCodeAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: clientSecret,
      oAuthRedirectUri: redirectUri,
      oAuthScopes: [
        OAuthScopeEnum.PlaylistModifyPrivate,
        OAuthScopeEnum.PlaylistModifyPublic,
        OAuthScopeEnum.UserReadPrivate,
      ],
    },
    timeout: 0,
    environment: Environment.Production,
  };
  const client = new Client(config);

  console.log('OAuth: Starting Spotify OAuth flow...');
  const authUrl = client.authorizationCodeAuthManager.buildAuthorizationUrl();
  const authCode = await getSpotifyAuthCode(authUrl, redirectUri);
  console.log('OAuth: Received authorization code. Fetching access token...');
  const token = await client.authorizationCodeAuthManager.fetchToken(authCode);
  if (!token) {
    throw new Error("Failed to fetch token!");
  }

  console.log('OAuth: Access token obtained. Creating new client with the token...');
  return client.withConfiguration({
         authorizationCodeAuthCredentials: {
           ...config.authorizationCodeAuthCredentials,
           oAuthToken: token
         }
  });
}

async function main() {
  // Step 1: Authenticate and setup client and controllers
  const client = await initializeSpotifyClientWithOAuth();

  const searchController = new SearchController(client);
  const artistsController = new ArtistsController(client);
  const playlistsController = new PlaylistsController(client);
  const usersController = new UsersController(client);

  const userProfile = await usersController.getCurrentUsersProfile();
  const userId = userProfile.result.id;
  console.log(`OAuth: User ID is ${userId}`);
  if (!userId) {
    throw new Error('Could not retrieve user ID.');
  }

  console.log('Step 1: Prompting for artist name...');
  const artistName = await prompt('Enter artist name: ');

  console.log('Step 2: Searching for artist...');
  const searchResult = await searchController.search(
    `artist:${artistName}`,
    [ItemTypeEnum.Artist],
    'US',
    10,
    0
  );
  const artists = searchResult.result.artists?.items || [];
  console.log(`Step 2: Found ${artists.length} artist(s).`);
  if (artists.length === 0) {
    console.log('No artists found.');
    return;
  }

  // Step 3: If multiple, prompt user to select
  let selectedArtist: typeof artists[0];
  if (artists.length === 1) {
    selectedArtist = artists[0];
    console.log(`Step 3: Only one artist found: ${selectedArtist.name}`);
  } else {
    console.log('Step 3: Multiple artists found:');
    artists.forEach((artist, idx) => {
      console.log(`${idx + 1}. ${artist.name} (Genres: ${artist.genres?.join(', ') || 'N/A'}, Popularity: ${artist.popularity})`);
    });
    const choice = await prompt('Select artist number: ');
    const idx = parseInt(choice, 10) - 1;
    if (idx < 0 || idx >= artists.length) {
      console.log('Invalid selection.');
      return;
    }
    selectedArtist = artists[idx];
    console.log(`Step 3: Selected artist: ${selectedArtist.name}`);
  }
  if (!selectedArtist.id) {
    console.log('Selected artist has no ID.');
    return;
  }

  // Print interesting details about the selected artist
  console.log('\nArtist Details:');
  console.log(`Name: ${selectedArtist.name}`);
  console.log(`Genres: ${selectedArtist.genres?.join(', ') || 'N/A'}`);
  console.log(`Popularity: ${selectedArtist.popularity}`);
  console.log(`Followers: ${selectedArtist.followers?.total ?? 'N/A'}`);
  console.log(`Spotify URL: ${selectedArtist.externalUrls?.spotify || 'N/A'}`);
  if (selectedArtist.images && selectedArtist.images.length > 0) {
    console.log(`Image URL: ${selectedArtist.images[0].url}`);
  }

}

main().catch((err) => {
  if (err instanceof OAuthProviderError) {
    console.error('OAuth Error:', err.result);
  }
  else if (err instanceof ApiError) {
    console.error('Spotify API Error:', err.result);
  } else {
    console.error('Unexpected Error:', err);
  }
});