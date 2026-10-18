import { Home } from './src/Home';
import { Login, Register } from './src/Auth';
import { Article } from './src/Article';
import { EditArticle, NewArticle } from './src/Editor';
import { Profile } from './src/Profile';
import { Settings } from './src/Settings';
import { Avatar } from './src/components';
import { me } from './src/session';

export function Main() {
  return (
    <div class="app">
      <header class="navbar">
        <a class="brand" route-to="/">conduit</a>
        <nav>
          <a route-to="/">Home</a>
          {me === null ? (
            <>
              <a route-to="/login">Sign in</a>
              <a route-to="/register">Sign up</a>
            </>
          ) : (
            <>
              <a route-to="/editor">✎ New Article</a>
              <a route-to="/settings">⚙ Settings</a>
              <a class="me" route-to={{ path: '/profile/:username', params: { username: me.username } }}>
                <Avatar profile={me} size={22} /> {me.username}
              </a>
            </>
          )}
        </nav>
      </header>

      <Home route="/" />
      <Login route="/login" />
      <Register route="/register" />
      <NewArticle route="/editor" />
      <EditArticle route="/editor/:slug" />
      <Article route="/article/:slug" />
      <Profile route="/profile/:username" />
      <Settings route="/settings" />
      <NotFound route="/*" />

      <footer>An interactive learning project. Built on Memoized DOM.</footer>
    </div>
  );
}

function NotFound() {
  return <section class="missing"><h1>Nothing lives here.</h1><a route-to="/">Back home</a></section>;
}
