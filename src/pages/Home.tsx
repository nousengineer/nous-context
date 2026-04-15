import React from 'react';
import Header from '../components/Header';
import Footer from '../components/Footer';

const Home = () => {
  return (
    <div>
      <Header />
      <main>
        <h2>Welcome to ThinkCoffee</h2>
        <p>Your favorite coffee shop!</p>
      </main>
      <Footer />
    </div>
  );
};

export default Home;